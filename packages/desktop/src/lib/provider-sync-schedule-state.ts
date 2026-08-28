import {
  readVersionedLocalStorage,
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
  type VersionedLocalStorageRead,
} from "@freed/ui/lib/versioned-local-storage";
import {
  AUTOMATIC_SYNC_PROVIDERS,
  createCryptoRandomSource,
  generateProviderCadenceBounds,
  nextProviderYieldFactor,
  normalizedOverdue,
  RELEASE_MIGRATION_WINDOW_MS,
  sampleProviderDelayMs,
  sampleProviderRegime,
  validateProviderCadenceBounds,
  type AutomaticSyncProvider,
  type ProviderCadenceBounds,
  type ProviderRegime,
  type RandomSource,
} from "./provider-sync-cadence";

export type ProviderSchedulePhase =
  | "waiting"
  | "due"
  | "locally_deferred"
  | "claimed"
  | "contacted"
  | "settled"
  | "backoff"
  | "blocked";

export type ProviderScheduleTrigger =
  | "scheduled"
  | "manual"
  | "post_login"
  | "migration";

export interface ProviderScheduleAttempt {
  attemptId: string;
  trigger: ProviderScheduleTrigger;
  scheduledAt: number;
  claimedAt: number;
  leaseUntil: number;
  contactCount: number;
  firstContactAt?: number;
}

export interface ProviderScheduleRecord {
  provider: AutomaticSyncProvider;
  phase: ProviderSchedulePhase;
  bounds: ProviderCadenceBounds;
  automaticPaused: boolean;
  nextDueAt: number;
  activationAt: number;
  regime: ProviderRegime;
  yieldFactor: number;
  consecutiveFailures: number;
  previousBackoffMs: number;
  migrationContext: "new_install" | "existing_install" | "meta_v1";
  localEligibilityRetryAt?: number;
  lastDeferralCategory?: string;
  lastAttemptStartedAt?: number;
  lastAttemptFinishedAt?: number;
  lastOutcome?: string;
  lastStage?: string;
  blockedReason?: string;
  attempt?: ProviderScheduleAttempt;
}

export interface ProviderScheduleSnapshot {
  status: "missing" | "supported" | "unsupported" | "corrupt" | "unavailable";
  record?: ProviderScheduleRecord;
}

interface GlobalAutomaticSyncConfig {
  automaticEnabled: boolean;
}

export interface ProviderScheduleCandidate {
  provider: AutomaticSyncProvider;
  dueAt: number;
  dueAgeMs: number;
  normalizedOverdue: number;
}

export type ProviderScheduleClaim =
  | {
      status: "claimed";
      record: ProviderScheduleRecord;
      attempt: ProviderScheduleAttempt;
      dueAgeMs: number;
    }
  | {
      status:
        | "not_due"
        | "paused"
        | "busy"
        | "storage_blocked"
        | "locally_deferred";
      provider?: AutomaticSyncProvider;
      nextEligibleAt?: number;
    };

export interface ProviderScheduleOwnershipReconciliation {
  busyProvider: AutomaticSyncProvider | null;
  abandonedProviders: AutomaticSyncProvider[];
}

const RECORD_PREFIX = "freed-device-provider-sync-state-v2:";
const GLOBAL_KEY = "freed-device-provider-sync-global-v1";
const INITIALIZED_KEY = "freed-device-provider-sync-initialized-v2";
const LEGACY_META_KEY = "freed-device-meta-sync-schedule-v1";
const DEFAULT_CLAIM_LEASE_MS = 15 * 60 * 1_000;
const LOCAL_DEFERRAL_MIN_MS = 45 * 1_000;
const LOCAL_DEFERRAL_MAX_MS = 2 * 60 * 1_000;
const MAX_FAILURE_BACKOFF_MS = 48 * 60 * 60 * 1_000;
const SCHEDULE_CHANGE_EVENT = "freed-provider-sync-schedule-change";

function notifyScheduleChange(changed: boolean): boolean {
  if (changed) window.dispatchEvent(new Event(SCHEDULE_CHANGE_EVENT));
  return changed;
}

interface LegacyMetaRecord {
  nextDueAt: number;
  lastAttemptStartedAt?: number;
  lastAttemptFinishedAt?: number;
  lastOutcome?: string;
  lastStage?: string;
  inFlightAttemptId?: string;
  inFlightStartedAt?: number;
}

type LegacyMetaRead =
  | { status: "missing" }
  | { status: "supported"; record: LegacyMetaRecord }
  | { status: "corrupt" | "unsupported" };

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function providerRecordKey(provider: AutomaticSyncProvider): string {
  return `${RECORD_PREFIX}${provider}`;
}

function isProvider(value: unknown): value is AutomaticSyncProvider {
  return AUTOMATIC_SYNC_PROVIDERS.includes(value as AutomaticSyncProvider);
}

function normalizeBounds(value: unknown): ProviderCadenceBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const bounds = {
    lowerMs: candidate.lowerMs,
    upperMs: candidate.upperMs,
    source: candidate.source,
  };
  if (
    (bounds.source !== "generated" && bounds.source !== "custom") ||
    typeof bounds.lowerMs !== "number" ||
    typeof bounds.upperMs !== "number" ||
    validateProviderCadenceBounds({
      lowerMs: bounds.lowerMs,
      upperMs: bounds.upperMs,
    })
  ) {
    return null;
  }
  return bounds as ProviderCadenceBounds;
}

function normalizeRegime(value: unknown): ProviderRegime | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const startedAt = finiteTimestamp(candidate.startedAt);
  const expiresAt = finiteTimestamp(candidate.expiresAt);
  if (
    typeof candidate.multiplier !== "number" ||
    !Number.isFinite(candidate.multiplier) ||
    candidate.multiplier < 0.5 ||
    candidate.multiplier > 2 ||
    startedAt === null ||
    expiresAt === null ||
    expiresAt <= startedAt
  ) {
    return null;
  }
  return { multiplier: candidate.multiplier, startedAt, expiresAt };
}

function normalizeAttempt(value: unknown): ProviderScheduleAttempt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const scheduledAt = finiteTimestamp(candidate.scheduledAt);
  const claimedAt = finiteTimestamp(candidate.claimedAt);
  const leaseUntil = finiteTimestamp(candidate.leaseUntil);
  const firstContactAt =
    candidate.firstContactAt === undefined
      ? undefined
      : finiteTimestamp(candidate.firstContactAt);
  if (
    typeof candidate.attemptId !== "string" ||
    candidate.attemptId.length === 0 ||
    candidate.attemptId.length > 160 ||
    !["scheduled", "manual", "post_login", "migration"].includes(
      String(candidate.trigger),
    ) ||
    scheduledAt === null ||
    claimedAt === null ||
    leaseUntil === null ||
    leaseUntil <= claimedAt ||
    typeof candidate.contactCount !== "number" ||
    !Number.isInteger(candidate.contactCount) ||
    candidate.contactCount < 0 ||
    candidate.contactCount > 1_000 ||
    firstContactAt === null
  ) {
    return null;
  }
  return {
    attemptId: candidate.attemptId,
    trigger: candidate.trigger as ProviderScheduleTrigger,
    scheduledAt,
    claimedAt,
    leaseUntil,
    contactCount: candidate.contactCount,
    ...(firstContactAt === undefined ? {} : { firstContactAt }),
  };
}

function normalizeRecord(value: unknown): ProviderScheduleRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  const bounds = normalizeBounds(candidate.bounds);
  const regime = normalizeRegime(candidate.regime);
  const nextDueAt = finiteTimestamp(candidate.nextDueAt);
  const activationAt = finiteTimestamp(candidate.activationAt);
  const phase = candidate.phase as ProviderSchedulePhase;
  const attempt = candidate.attempt === undefined ? undefined : normalizeAttempt(candidate.attempt);
  if (
    !isProvider(provider) ||
    ![
      "waiting",
      "due",
      "locally_deferred",
      "claimed",
      "contacted",
      "settled",
      "backoff",
      "blocked",
    ].includes(phase) ||
    !bounds ||
    !regime ||
    nextDueAt === null ||
    activationAt === null ||
    typeof candidate.automaticPaused !== "boolean" ||
    typeof candidate.yieldFactor !== "number" ||
    !Number.isFinite(candidate.yieldFactor) ||
    candidate.yieldFactor < 0.8 ||
    candidate.yieldFactor > 2 ||
    typeof candidate.consecutiveFailures !== "number" ||
    !Number.isInteger(candidate.consecutiveFailures) ||
    candidate.consecutiveFailures < 0 ||
    typeof candidate.previousBackoffMs !== "number" ||
    !Number.isFinite(candidate.previousBackoffMs) ||
    candidate.previousBackoffMs < 0 ||
    !["new_install", "existing_install", "meta_v1"].includes(
      String(candidate.migrationContext),
    ) ||
    attempt === null ||
    (["claimed", "contacted"].includes(phase) !== Boolean(attempt))
  ) {
    return null;
  }
  const optionalTimestamps: Partial<ProviderScheduleRecord> = {};
  for (const key of [
    "localEligibilityRetryAt",
    "lastAttemptStartedAt",
    "lastAttemptFinishedAt",
  ] as const) {
    if (candidate[key] === undefined) continue;
    const parsed = finiteTimestamp(candidate[key]);
    if (parsed === null) return null;
    optionalTimestamps[key] = parsed;
  }
  const optionalStrings: Partial<ProviderScheduleRecord> = {};
  for (const key of [
    "lastDeferralCategory",
    "lastOutcome",
    "lastStage",
    "blockedReason",
  ] as const) {
    if (candidate[key] === undefined) continue;
    if (typeof candidate[key] !== "string") return null;
    optionalStrings[key] = candidate[key].slice(0, 160);
  }
  return {
    provider,
    phase,
    bounds,
    automaticPaused: candidate.automaticPaused,
    nextDueAt,
    activationAt,
    regime,
    yieldFactor: candidate.yieldFactor,
    consecutiveFailures: candidate.consecutiveFailures,
    previousBackoffMs: candidate.previousBackoffMs,
    migrationContext: candidate.migrationContext as ProviderScheduleRecord["migrationContext"],
    ...optionalTimestamps,
    ...optionalStrings,
    ...(attempt ? { attempt } : {}),
  };
}

const RECORD_CODEC: VersionedLocalStorageCodec<ProviderScheduleRecord> = {
  version: 2,
  decode(value) {
    return normalizeRecord(value.record);
  },
  encode(record) {
    return { record };
  },
};

const GLOBAL_CODEC: VersionedLocalStorageCodec<GlobalAutomaticSyncConfig> = {
  version: 1,
  decode(value) {
    const config = value.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) return null;
    const enabled = (config as Record<string, unknown>).automaticEnabled;
    return typeof enabled === "boolean" ? { automaticEnabled: enabled } : null;
  },
  encode(config) {
    return { config };
  },
};

function readRecord(provider: AutomaticSyncProvider): VersionedLocalStorageRead<ProviderScheduleRecord> {
  return readVersionedLocalStorage(providerRecordKey(provider), RECORD_CODEC);
}

function writeRecord(record: ProviderScheduleRecord): boolean {
  const existing = readRecord(record.provider);
  if (existing.status === "corrupt" || existing.status === "unsupported") return false;
  return writeVersionedLocalStorage(providerRecordKey(record.provider), RECORD_CODEC, record);
}

function readLegacyMetaRecord(provider: AutomaticSyncProvider): LegacyMetaRead {
  if (provider !== "facebook" && provider !== "instagram") {
    return { status: "missing" };
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_META_KEY);
    if (!raw) return { status: "missing" };
    const value = JSON.parse(raw) as {
      version?: unknown;
      providers?: Record<string, Record<string, unknown>>;
    };
    if (value.version !== 1) return { status: "unsupported" };
    if (!value.providers || typeof value.providers !== "object") {
      return { status: "corrupt" };
    }
    const candidate = value.providers[provider];
    if (candidate === undefined) return { status: "missing" };
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { status: "corrupt" };
    }
    const nextDueAt = finiteTimestamp(candidate.nextDueAt);
    if (nextDueAt === null) return { status: "corrupt" };
    const record: LegacyMetaRecord = { nextDueAt };
    for (const field of [
      "lastAttemptStartedAt",
      "lastAttemptFinishedAt",
      "inFlightStartedAt",
    ] as const) {
      if (candidate[field] === undefined) continue;
      const timestamp = finiteTimestamp(candidate[field]);
      if (timestamp === null) return { status: "corrupt" };
      record[field] = timestamp;
    }
    for (const field of ["lastOutcome", "lastStage"] as const) {
      if (candidate[field] === undefined) continue;
      if (typeof candidate[field] !== "string") return { status: "corrupt" };
      record[field] = candidate[field].slice(0, 160);
    }
    if (candidate.inFlightAttemptId !== undefined) {
      if (
        typeof candidate.inFlightAttemptId !== "string" ||
        candidate.inFlightAttemptId.length === 0 ||
        candidate.inFlightAttemptId.length > 160
      ) {
        return { status: "corrupt" };
      }
      record.inFlightAttemptId = candidate.inFlightAttemptId;
    }
    if (
      Boolean(record.inFlightAttemptId) !==
      Boolean(record.inFlightStartedAt !== undefined)
    ) {
      return { status: "corrupt" };
    }
    return { status: "supported", record };
  } catch {
    return { status: "corrupt" };
  }
}

function newRecord(input: {
  provider: AutomaticSyncProvider;
  now: number;
  random: RandomSource;
  existingInstall: boolean;
  legacyMeta: LegacyMetaRecord | null;
}): ProviderScheduleRecord {
  const bounds = generateProviderCadenceBounds(input.provider, input.random);
  const regime = sampleProviderRegime(input.now, input.random);
  const sampledDueAt =
    input.now +
    sampleProviderDelayMs({
      bounds,
      regimeMultiplier: regime.multiplier,
      yieldFactor: 1,
      random: input.random,
    });
  const legacyDueAt = input.legacyMeta?.nextDueAt ?? null;
  const activationAt = input.existingInstall
    ? input.now + input.random.uniform() * RELEASE_MIGRATION_WINDOW_MS
    : input.now;
  const legacyAttempt = input.legacyMeta?.inFlightAttemptId &&
      input.legacyMeta.inFlightStartedAt !== undefined
    ? {
        attemptId: input.legacyMeta.inFlightAttemptId,
        trigger: "migration" as const,
        scheduledAt: Math.min(
          input.legacyMeta.nextDueAt,
          input.legacyMeta.inFlightStartedAt,
        ),
        claimedAt: input.legacyMeta.inFlightStartedAt,
        leaseUntil: input.legacyMeta.inFlightStartedAt + DEFAULT_CLAIM_LEASE_MS,
        contactCount: 1,
        firstContactAt: input.legacyMeta.inFlightStartedAt,
      }
    : undefined;
  return {
    provider: input.provider,
    phase: legacyAttempt ? "contacted" : "waiting",
    bounds,
    automaticPaused: false,
    nextDueAt: Math.max(sampledDueAt, activationAt, legacyDueAt ?? 0),
    activationAt,
    regime,
    yieldFactor: 1,
    consecutiveFailures: 0,
    previousBackoffMs: 0,
    migrationContext:
      legacyDueAt === null
        ? input.existingInstall
          ? "existing_install"
          : "new_install"
        : "meta_v1",
    ...(input.legacyMeta?.lastAttemptStartedAt === undefined
      ? {}
      : { lastAttemptStartedAt: input.legacyMeta.lastAttemptStartedAt }),
    ...(input.legacyMeta?.lastAttemptFinishedAt === undefined
      ? {}
      : { lastAttemptFinishedAt: input.legacyMeta.lastAttemptFinishedAt }),
    ...(input.legacyMeta?.lastOutcome === undefined
      ? {}
      : { lastOutcome: input.legacyMeta.lastOutcome }),
    ...(input.legacyMeta?.lastStage === undefined
      ? {}
      : { lastStage: input.legacyMeta.lastStage }),
    ...(legacyAttempt ? { attempt: legacyAttempt } : {}),
  };
}

export function initializeProviderSchedules(input: {
  now?: number;
  random?: RandomSource;
  existingInstall?: boolean;
} = {}): { initialized: AutomaticSyncProvider[]; blocked: AutomaticSyncProvider[] } {
  const now = input.now ?? Date.now();
  const random = input.random ?? createCryptoRandomSource();
  const existingInstall = input.existingInstall ?? false;
  const initialized: AutomaticSyncProvider[] = [];
  const blocked: AutomaticSyncProvider[] = [];
  for (const provider of AUTOMATIC_SYNC_PROVIDERS) {
    const state = readRecord(provider);
    if (state.status === "supported") continue;
    if (state.status !== "missing") {
      blocked.push(provider);
      continue;
    }
    const legacyMeta = readLegacyMetaRecord(provider);
    if (legacyMeta.status === "corrupt" || legacyMeta.status === "unsupported") {
      blocked.push(provider);
      continue;
    }
    if (writeRecord(newRecord({
      provider,
      now,
      random,
      existingInstall,
      legacyMeta: legacyMeta.status === "supported" ? legacyMeta.record : null,
    }))) {
      initialized.push(provider);
    } else {
      blocked.push(provider);
    }
  }
  try {
    if (!window.localStorage.getItem(INITIALIZED_KEY)) {
      window.localStorage.setItem(INITIALIZED_KEY, String(now));
    }
  } catch {
    // Per-provider stores remain authoritative even if this hint is unavailable.
  }
  const global = readVersionedLocalStorage(GLOBAL_KEY, GLOBAL_CODEC);
  if (global.status === "missing") {
    writeVersionedLocalStorage(GLOBAL_KEY, GLOBAL_CODEC, { automaticEnabled: true });
  }
  return { initialized, blocked };
}

export function getProviderScheduleSnapshot(provider: AutomaticSyncProvider): ProviderScheduleSnapshot {
  const state = readRecord(provider);
  return state.status === "supported"
    ? { status: "supported", record: state.value }
    : { status: state.status };
}

export function getAutomaticProviderSyncEnabled(): boolean {
  const state = readVersionedLocalStorage(GLOBAL_KEY, GLOBAL_CODEC);
  return state.status === "missing" ||
    (state.status === "supported" && state.value.automaticEnabled);
}

export function setAutomaticProviderSyncEnabled(enabled: boolean): boolean {
  const state = readVersionedLocalStorage(GLOBAL_KEY, GLOBAL_CODEC);
  if (state.status === "corrupt" || state.status === "unsupported") return false;
  return notifyScheduleChange(
    writeVersionedLocalStorage(GLOBAL_KEY, GLOBAL_CODEC, {
      automaticEnabled: enabled,
    }),
  );
}

export function updateProviderCadenceBounds(
  provider: AutomaticSyncProvider,
  bounds: ProviderCadenceBounds,
): boolean {
  if (validateProviderCadenceBounds(bounds)) return false;
  const state = readRecord(provider);
  if (state.status !== "supported") return false;
  return notifyScheduleChange(writeRecord({ ...state.value, bounds }));
}

export function setProviderAutomaticPaused(
  provider: AutomaticSyncProvider,
  automaticPaused: boolean,
): boolean {
  const state = readRecord(provider);
  if (state.status !== "supported") return false;
  return notifyScheduleChange(writeRecord({ ...state.value, automaticPaused }));
}

export function resetProviderCadenceDefaults(
  provider: AutomaticSyncProvider,
  input: { now?: number; random?: RandomSource } = {},
): boolean {
  const state = readRecord(provider);
  if (state.status !== "supported") return false;
  const now = input.now ?? Date.now();
  const random = input.random ?? createCryptoRandomSource();
  const bounds = generateProviderCadenceBounds(provider, random);
  const regime = sampleProviderRegime(now, random);
  const delay = sampleProviderDelayMs({
    bounds,
    regimeMultiplier: regime.multiplier,
    yieldFactor: 1,
    random,
  });
  return notifyScheduleChange(writeRecord({
    ...state.value,
    bounds,
    regime,
    yieldFactor: 1,
    consecutiveFailures: 0,
    previousBackoffMs: 0,
    nextDueAt: Math.max(state.value.nextDueAt, now + delay),
  }));
}

export function listDueProviderSchedules(now = Date.now()): ProviderScheduleCandidate[] {
  if (!getAutomaticProviderSyncEnabled()) return [];
  const candidates: ProviderScheduleCandidate[] = [];
  for (const provider of AUTOMATIC_SYNC_PROVIDERS) {
    const state = readRecord(provider);
    if (state.status !== "supported") continue;
    const record = state.value;
    if (
      record.automaticPaused ||
      record.phase === "blocked" ||
      record.attempt ||
      record.activationAt > now ||
      (record.localEligibilityRetryAt ?? 0) > now ||
      record.nextDueAt > now
    ) {
      continue;
    }
    if (record.phase !== "due") {
      writeRecord({ ...record, phase: "due" });
    }
    candidates.push({
      provider,
      dueAt: record.nextDueAt,
      dueAgeMs: now - record.nextDueAt,
      normalizedOverdue: normalizedOverdue(now, record.nextDueAt, record.bounds.lowerMs),
    });
  }
  return candidates;
}

export function deferProviderScheduleLocally(input: {
  provider: AutomaticSyncProvider;
  category: string;
  now?: number;
  random?: RandomSource;
}): boolean {
  const state = readRecord(input.provider);
  if (state.status !== "supported") return false;
  const now = input.now ?? Date.now();
  const random = input.random ?? createCryptoRandomSource();
  const delay =
    LOCAL_DEFERRAL_MIN_MS +
    random.uniform() * (LOCAL_DEFERRAL_MAX_MS - LOCAL_DEFERRAL_MIN_MS);
  return writeRecord({
    ...state.value,
    phase: "locally_deferred",
    localEligibilityRetryAt: now + delay,
    lastDeferralCategory: input.category.slice(0, 160),
  });
}

function abandonAttempt(
  record: ProviderScheduleRecord,
  now: number,
  random: RandomSource,
): boolean {
  const regime =
    record.regime.expiresAt <= now
      ? sampleProviderRegime(now, random)
      : record.regime;
  const safeDelay = sampleProviderDelayMs({
    bounds: record.bounds,
    regimeMultiplier: regime.multiplier,
    yieldFactor: record.yieldFactor,
    random,
  });
  return writeRecord({
    ...record,
    phase: "settled",
    regime,
    nextDueAt: Math.max(record.nextDueAt, now + safeDelay),
    attempt: undefined,
    lastAttemptFinishedAt: now,
    lastOutcome: "abandoned",
    lastStage: "stale_lease",
  });
}

export function reconcileProviderScheduleOwnership(input: {
  now?: number;
  random?: RandomSource;
  nativeStatusAvailable?: boolean;
  nativeOperationActive?: boolean;
  nativeActiveProvider?: AutomaticSyncProvider | null;
} = {}): ProviderScheduleOwnershipReconciliation {
  const now = input.now ?? Date.now();
  const random = input.random ?? createCryptoRandomSource();
  const abandonedProviders: AutomaticSyncProvider[] = [];
  const attemptedProviders: AutomaticSyncProvider[] = [];
  for (const provider of AUTOMATIC_SYNC_PROVIDERS) {
    const state = readRecord(provider);
    if (state.status !== "supported" || !state.value.attempt) continue;
    attemptedProviders.push(provider);
  }

  if (input.nativeStatusAvailable && input.nativeOperationActive) {
    const owner =
      input.nativeActiveProvider ?? attemptedProviders[0] ?? null;
    if (owner) {
      const state = readRecord(owner);
      if (state.status === "supported" && state.value.attempt) {
        const retained = writeRecord({
          ...state.value,
          attempt: {
            ...state.value.attempt,
            leaseUntil: Math.max(
              state.value.attempt.leaseUntil,
              now + DEFAULT_CLAIM_LEASE_MS,
            ),
          },
        });
        if (!retained) {
          return { busyProvider: owner, abandonedProviders };
        }
      }
    }
    return { busyProvider: owner, abandonedProviders };
  }

  for (const provider of attemptedProviders) {
    const state = readRecord(provider);
    if (state.status !== "supported" || !state.value.attempt) continue;
    if (!input.nativeStatusAvailable && state.value.attempt.leaseUntil > now) {
      return { busyProvider: provider, abandonedProviders };
    }
    const record = state.value;
    if (!abandonAttempt(record, now, random)) {
      return { busyProvider: provider, abandonedProviders };
    }
    abandonedProviders.push(provider);
  }
  return { busyProvider: null, abandonedProviders };
}

export function claimProviderSchedule(input: {
  provider: AutomaticSyncProvider;
  now?: number;
  random?: RandomSource;
  claimLeaseMs?: number;
}): ProviderScheduleClaim {
  const now = input.now ?? Date.now();
  const random = input.random ?? createCryptoRandomSource();
  if (!getAutomaticProviderSyncEnabled()) return { status: "paused" };
  const ownership = reconcileProviderScheduleOwnership({ now, random });
  if (ownership.busyProvider) {
    return { status: "busy", provider: ownership.busyProvider };
  }
  const state = readRecord(input.provider);
  if (state.status !== "supported") return { status: "storage_blocked" };
  const record = state.value;
  if (record.automaticPaused || record.phase === "blocked") return { status: "paused" };
  if ((record.localEligibilityRetryAt ?? 0) > now) {
    return { status: "locally_deferred", nextEligibleAt: record.localEligibilityRetryAt };
  }
  if (record.activationAt > now || record.nextDueAt > now) {
    return { status: "not_due", nextEligibleAt: Math.max(record.activationAt, record.nextDueAt) };
  }
  const delay = sampleProviderDelayMs({
    bounds: record.bounds,
    regimeMultiplier: record.regime.multiplier,
    yieldFactor: record.yieldFactor,
    random,
  });
  const attempt: ProviderScheduleAttempt = {
    attemptId: `${input.provider}:${random.id()}`,
    trigger: "scheduled",
    scheduledAt: record.nextDueAt,
    claimedAt: now,
    leaseUntil: now + (input.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS),
    contactCount: 0,
  };
  const claimed: ProviderScheduleRecord = {
    ...record,
    phase: "claimed",
    nextDueAt: now + delay,
    localEligibilityRetryAt: undefined,
    lastDeferralCategory: undefined,
    lastAttemptStartedAt: now,
    attempt,
  };
  if (!writeRecord(claimed)) return { status: "storage_blocked" };
  return { status: "claimed", record: claimed, attempt, dueAgeMs: now - record.nextDueAt };
}

export function markProviderContactIssued(input: {
  provider: AutomaticSyncProvider;
  attemptId: string;
  now?: number;
}): ProviderScheduleAttempt | null {
  const state = readRecord(input.provider);
  if (state.status !== "supported") return null;
  const record = state.value;
  if (!record.attempt || record.attempt.attemptId !== input.attemptId) return null;
  const now = input.now ?? Date.now();
  const attempt = {
    ...record.attempt,
    contactCount: record.attempt.contactCount + 1,
    firstContactAt: record.attempt.firstContactAt ?? now,
  };
  return writeRecord({ ...record, phase: "contacted", attempt }) ? attempt : null;
}

export function settleProviderSchedule(input: {
  provider: AutomaticSyncProvider;
  attemptId: string;
  now?: number;
  random?: RandomSource;
  status: "success" | "empty" | "deferred" | "error" | "ignored";
  stage?: string | null;
  itemsSeen?: number;
  itemsAdded?: number;
  retryAfterMs?: number;
  authBlocked?: boolean;
}): boolean {
  const state = readRecord(input.provider);
  if (state.status !== "supported") return false;
  const record = state.value;
  if (!record.attempt || record.attempt.attemptId !== input.attemptId) return false;
  const now = input.now ?? Date.now();
  const random = input.random ?? createCryptoRandomSource();
  const contacted = record.attempt.contactCount > 0;
  const stage = input.stage?.slice(0, 160);
  if (!contacted && input.status === "deferred") {
    return writeRecord({
      ...record,
      phase: "locally_deferred",
      nextDueAt: record.attempt.scheduledAt,
      localEligibilityRetryAt:
        now +
        LOCAL_DEFERRAL_MIN_MS +
        random.uniform() * (LOCAL_DEFERRAL_MAX_MS - LOCAL_DEFERRAL_MIN_MS),
      lastDeferralCategory: stage ?? "adapter_deferred",
      attempt: undefined,
      lastAttemptFinishedAt: now,
      lastOutcome: "deferred",
      lastStage: stage,
    });
  }
  if (input.authBlocked) {
    return writeRecord({
      ...record,
      phase: "blocked",
      attempt: undefined,
      blockedReason: "auth",
      lastAttemptFinishedAt: now,
      lastOutcome: input.status,
      lastStage: stage ?? "auth",
    });
  }
  let nextDueAt = record.nextDueAt;
  let phase: ProviderSchedulePhase = "settled";
  let failures = 0;
  let previousBackoffMs = 0;
  if (contacted && input.status === "error") {
    failures = record.consecutiveFailures + 1;
    const lower = Math.max(record.bounds.lowerMs, record.previousBackoffMs || record.bounds.lowerMs);
    const decorrelated = lower + random.uniform() * Math.max(1, lower * 3 - lower);
    previousBackoffMs = Math.min(MAX_FAILURE_BACKOFF_MS, decorrelated);
    const retryAfter = Math.max(0, input.retryAfterMs ?? 0);
    nextDueAt = Math.max(nextDueAt, now + Math.max(retryAfter, previousBackoffMs));
    phase = "backoff";
  }
  const yieldFactor = nextProviderYieldFactor({
    current: record.yieldFactor,
    status: input.status === "deferred" ? "ignored" : input.status,
    itemsSeen: input.itemsSeen ?? 0,
    itemsAdded: input.itemsAdded ?? 0,
  });
  const regime =
    record.regime.expiresAt <= now
      ? sampleProviderRegime(now, random)
      : record.regime;
  return writeRecord({
    ...record,
    phase,
    nextDueAt,
    regime,
    yieldFactor,
    consecutiveFailures: failures,
    previousBackoffMs,
    attempt: undefined,
    blockedReason: undefined,
    lastAttemptFinishedAt: now,
    lastOutcome: input.status,
    lastStage: stage,
  });
}

export function rescheduleProviderAfterExternalSettlement(input: {
  provider: AutomaticSyncProvider;
  now?: number;
  random?: RandomSource;
  unblockAuth?: boolean;
}): boolean {
  const state = readRecord(input.provider);
  if (state.status !== "supported" || state.value.attempt) return false;
  const now = input.now ?? Date.now();
  const random = input.random ?? createCryptoRandomSource();
  const record = state.value;
  const regime = record.regime.expiresAt <= now ? sampleProviderRegime(now, random) : record.regime;
  const delay = sampleProviderDelayMs({
    bounds: record.bounds,
    regimeMultiplier: regime.multiplier,
    yieldFactor: record.yieldFactor,
    random,
  });
  return notifyScheduleChange(writeRecord({
    ...record,
    phase:
      record.phase === "blocked" && !input.unblockAuth ? "blocked" : "waiting",
    regime,
    nextDueAt: now + delay,
    blockedReason:
      record.phase === "blocked" && !input.unblockAuth
        ? record.blockedReason
        : undefined,
  }));
}

export function clearProviderScheduleStateForFactoryReset(): boolean {
  try {
    for (const provider of AUTOMATIC_SYNC_PROVIDERS) {
      window.localStorage.removeItem(providerRecordKey(provider));
    }
    window.localStorage.removeItem(GLOBAL_KEY);
    window.localStorage.removeItem(INITIALIZED_KEY);
    window.localStorage.removeItem(LEGACY_META_KEY);
    return true;
  } catch {
    return false;
  }
}
