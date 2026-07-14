import { isTauri } from "@tauri-apps/api/core";
import { toast } from "@freed/ui/components/Toast";
import { formatProviderStatusMessage } from "@freed/ui/lib/provider-status";
import {
  setProviderHealth,
  type HealthDailyBucket,
  type HealthHourlyBucket,
  type HealthOutcome,
  type HealthProviderId,
  type HealthSignalType,
  type ProviderHealthAttempt,
  type ProviderHealthSnapshot,
  type ProviderPauseState,
  type RssFeedHealthSnapshot,
} from "@freed/ui/lib/debug-store";
import { useSettingsStore } from "@freed/ui/lib/settings-store";
import { log } from "./logger";
import { useAppStore } from "./store";
import { storeFbAuthState } from "./fb-auth";
import { storeIgAuthState } from "./instagram-auth";
import { storeLiAuthState } from "./li-auth";
import { storeSubstackAuthState } from "./substack-auth";
import { storeMediumAuthState } from "./medium-auth";
import { storeYouTubeAuthState } from "./youtube-auth";
import { readNativeJsonFileRaw, writeNativeJsonFile } from "./native-json-store";

const HEALTH_STORE_FILE = "sync-health.json";
const HEALTH_STORE_KEY = "provider-health";
const FALLBACK_STORAGE_KEY = "freed.provider-health";
const MOCK_STORE_STORAGE_KEY = `__TAURI_MOCK_STORE__:${HEALTH_STORE_FILE}`;
const MAX_PROVIDER_ATTEMPTS = 20;
const MAX_FEED_ATTEMPTS = 5;
const MAX_ATTEMPT_REASON_CHARS = 240;
const MAX_FEED_TITLE_CHARS = 180;
const RSS_HEALTH_PERSIST_DEBOUNCE_MS = 5_000;
const PROVIDERS: HealthProviderId[] = [
  "rss",
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "substack",
  "medium",
  "youtube",
  "gdrive",
  "dropbox",
];
const LEGACY_VERSION_ONE_PROVIDERS = new Set<HealthProviderId>([
  "rss",
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "gdrive",
  "dropbox",
]);
const SOCIAL_PROVIDERS = new Set<HealthProviderId>([
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "substack",
  "medium",
  "youtube",
]);
const DEFAULT_DAILY_BUCKETS = 7;
const DEFAULT_HOURLY_BUCKETS = 24;
const PAUSE_HOURS = [2, 4, 6] as const;
const RATE_LIMIT_HEURISTIC_WINDOW_MS = 90 * 60 * 1000;
const FAILING_FEED_OUTAGE_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_MEMORY_PRESSURE_STATUS_MS = 15 * 60 * 1000;
const STORAGE_BLOCK_PAUSE_MS = 100 * 365 * 24 * 60 * 60 * 1000;
const STORAGE_BLOCK_MESSAGE =
  "Freed paused automatic provider sync because its local request history could not be read. Choose Sync now to preserve the existing record and resume.";

type HealthStage =
  | "fetch"
  | "parse"
  | "normalize"
  | "instructions"
  | "timeout"
  | "extract"
  | "transport"
  | "invoke"
  | "auth"
  | "provider_rate_limit"
  | "cooldown"
  | "empty"
  | "merge"
  | "upload"
  | "download"
  | "poll"
  | "unknown";

export interface ProviderHealthEventInput {
  provider: HealthProviderId;
  scope?: "provider" | "rss_feed";
  feedUrl?: string;
  feedTitle?: string;
  outcome: HealthOutcome;
  stage?: HealthStage | string;
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
  itemsSeen?: number;
  itemsAdded?: number;
  bytesMoved?: number;
  signalType?: HealthSignalType;
}

interface PersistedFeedHealth {
  feedUrl: string;
  feedTitle: string;
  dailyBuckets: HealthDailyBucket[];
  hourlyBuckets: HealthHourlyBucket[];
  latestAttempts: ProviderHealthAttempt[];
}

interface PersistedProviderHealth {
  provider: HealthProviderId;
  dailyBuckets: HealthDailyBucket[];
  hourlyBuckets: HealthHourlyBucket[];
  latestAttempts: ProviderHealthAttempt[];
  pause: ProviderPauseState | null;
  lastPauseLevel?: 1 | 2 | 3;
  lastPauseDetectedAt?: number;
}

interface PersistedHealthState {
  version: 1;
  providers: Record<HealthProviderId, PersistedProviderHealth>;
  rssFeeds: Record<string, PersistedFeedHealth>;
  updatedAt: number;
}

type HealthStorageStatus =
  | "loading"
  | "missing"
  | "supported"
  | "unsupported"
  | "corrupt"
  | "unavailable";

interface HealthStorageIssue {
  status: "unsupported" | "corrupt" | "unavailable";
  source: "native" | "fallback" | "mock";
  reason: string;
  raw: string | null;
  detectedAt: number;
}

interface HealthStateReadResult {
  status: Exclude<HealthStorageStatus, "loading">;
  state: PersistedHealthState;
  issue: HealthStorageIssue | null;
}

type RawHealthReadResult =
  | { status: "available"; raw: string; source: "fallback" | "mock" }
  | { status: "missing" }
  | { status: "unavailable"; issue: HealthStorageIssue };

let currentState: PersistedHealthState | null = null;
let initPromise: Promise<void> | null = null;
let pendingPersistState: PersistedHealthState | null = null;
let pendingPersistTimer: ReturnType<typeof setTimeout> | null = null;
let latestFailingRssFeeds: RssFeedHealthSnapshot[] = [];
let healthStorageStatus: HealthStorageStatus = "loading";
let healthStorageIssue: HealthStorageIssue | null = null;
let recoverySequence = 0;

function defaultDailyBuckets(now = Date.now()): HealthDailyBucket[] {
  return Array.from({ length: DEFAULT_DAILY_BUCKETS }, (_unused, index) => {
    const date = new Date(now - (DEFAULT_DAILY_BUCKETS - index - 1) * 24 * 60 * 60 * 1000);
    const dateKey = date.toISOString().slice(0, 10);
    return {
      dateKey,
      attempts: 0,
      successes: 0,
      failures: 0,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
    };
  });
}

function defaultHourlyBuckets(now = Date.now()): HealthHourlyBucket[] {
  return Array.from({ length: DEFAULT_HOURLY_BUCKETS }, (_unused, index) => {
    const date = new Date(now - (DEFAULT_HOURLY_BUCKETS - index - 1) * 60 * 60 * 1000);
    const hourKey = date.toISOString().slice(0, 13);
    return {
      hourKey,
      attempts: 0,
      successes: 0,
      failures: 0,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
    };
  });
}

function emptyProviderState(provider: HealthProviderId, now = Date.now()): PersistedProviderHealth {
  return {
    provider,
    dailyBuckets: defaultDailyBuckets(now),
    hourlyBuckets: defaultHourlyBuckets(now),
    latestAttempts: [],
    pause: null,
    lastPauseLevel: undefined,
    lastPauseDetectedAt: undefined,
  };
}

function createEmptyState(now = Date.now()): PersistedHealthState {
  return {
    version: 1,
    providers: {
      rss: emptyProviderState("rss", now),
      x: emptyProviderState("x", now),
      facebook: emptyProviderState("facebook", now),
      instagram: emptyProviderState("instagram", now),
      linkedin: emptyProviderState("linkedin", now),
      substack: emptyProviderState("substack", now),
      medium: emptyProviderState("medium", now),
      youtube: emptyProviderState("youtube", now),
      gdrive: emptyProviderState("gdrive", now),
      dropbox: emptyProviderState("dropbox", now),
    },
    rssFeeds: {},
    updatedAt: now,
  };
}

function createStorageIssue(
  status: HealthStorageIssue["status"],
  source: HealthStorageIssue["source"],
  reason: string,
  raw: string | null,
): HealthStorageIssue {
  return {
    status,
    source,
    reason,
    raw,
    detectedAt: Date.now(),
  };
}

function readFallbackRaw(): RawHealthReadResult {
  if (typeof window === "undefined") {
    return {
      status: "unavailable",
      issue: createStorageIssue(
        "unavailable",
        "fallback",
        "Local storage is unavailable.",
        null,
      ),
    };
  }

  try {
    const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (raw !== null) return { status: "available", raw, source: "fallback" };
  } catch (error) {
    return {
      status: "unavailable",
      issue: createStorageIssue(
        "unavailable",
        "fallback",
        error instanceof Error ? error.message : String(error),
        null,
      ),
    };
  }

  try {
    const raw = window.localStorage.getItem(MOCK_STORE_STORAGE_KEY);
    if (raw !== null) return { status: "available", raw, source: "mock" };
    return { status: "missing" };
  } catch (error) {
    return {
      status: "unavailable",
      issue: createStorageIssue(
        "unavailable",
        "mock",
        error instanceof Error ? error.message : String(error),
        null,
      ),
    };
  }
}

function fallbackWrite(state: PersistedHealthState): boolean {
  let persisted = false;
  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(state));
    persisted = true;
  } catch {
    // Ignore fallback storage failures.
  }

  try {
    const raw = window.localStorage.getItem(MOCK_STORE_STORAGE_KEY);
    const parsed =
      raw && raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed[HEALTH_STORE_KEY] = state;
    window.localStorage.setItem(MOCK_STORE_STORAGE_KEY, JSON.stringify(parsed));
    persisted = true;
  } catch {
    // Ignore mock store persistence failures.
  }
  return persisted;
}

function coerceBuckets<T extends HealthDailyBucket | HealthHourlyBucket>(
  buckets: T[] | undefined,
  defaults: T[],
  key: "dateKey" | "hourKey",
): T[] {
  if (!Array.isArray(buckets)) return defaults;
  const map = new Map<string, T>();
  for (const bucket of buckets) {
    const bucketKey =
      key === "dateKey"
        ? ("dateKey" in bucket ? bucket.dateKey : undefined)
        : ("hourKey" in bucket ? bucket.hourKey : undefined);
    if (typeof bucketKey === "string") {
      map.set(bucketKey, {
        ...bucket,
        attempts: Number(bucket.attempts ?? 0),
        successes: Number(bucket.successes ?? 0),
        failures: Number(bucket.failures ?? 0),
        itemsSeen: Number(bucket.itemsSeen ?? 0),
        itemsAdded: Number(bucket.itemsAdded ?? 0),
        bytesMoved: Number((bucket as HealthDailyBucket).bytesMoved ?? 0),
      } as T);
    }
  }
  return defaults.map((bucket) => {
    const bucketKey =
      key === "dateKey"
        ? ("dateKey" in bucket ? bucket.dateKey : "")
        : ("hourKey" in bucket ? bucket.hourKey : "");
    return map.get(bucketKey) ?? bucket;
  });
}

function coerceAttempts(
  attempts: unknown,
  max: number,
): ProviderHealthAttempt[] {
  if (!Array.isArray(attempts)) return [];
  return attempts
    .map((attempt) => coerceAttempt(attempt))
    .filter((attempt): attempt is ProviderHealthAttempt => !!attempt)
    .slice(0, max);
}

function compactText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function compactAttempt(attempt: ProviderHealthAttempt): ProviderHealthAttempt {
  return {
    ...attempt,
    feedTitle: compactText(attempt.feedTitle, MAX_FEED_TITLE_CHARS),
    reason: compactText(attempt.reason, MAX_ATTEMPT_REASON_CHARS),
  };
}

function coerceAttempt(value: unknown): ProviderHealthAttempt | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as Partial<ProviderHealthAttempt>;
  if (typeof attempt.provider !== "string" || typeof attempt.outcome !== "string") {
    return null;
  }
  return {
    id: typeof attempt.id === "string" ? attempt.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    provider: attempt.provider as HealthProviderId,
    scope: attempt.provider === "rss" ? "rss_feed" : "provider",
    feedUrl: typeof attempt.feedUrl === "string" ? attempt.feedUrl : undefined,
    feedTitle: compactText(
      typeof attempt.feedTitle === "string" ? attempt.feedTitle : undefined,
      MAX_FEED_TITLE_CHARS,
    ),
    outcome: attempt.outcome as HealthOutcome,
    stage: typeof attempt.stage === "string" ? attempt.stage : undefined,
    reason: compactText(
      typeof attempt.reason === "string" ? attempt.reason : undefined,
      MAX_ATTEMPT_REASON_CHARS,
    ),
    startedAt: Number(attempt.startedAt ?? Date.now()),
    finishedAt: Number(attempt.finishedAt ?? Date.now()),
    durationMs: Number(attempt.durationMs ?? 0),
    itemsSeen: Number(attempt.itemsSeen ?? 0),
    itemsAdded: Number(attempt.itemsAdded ?? 0),
    bytesMoved: Number(attempt.bytesMoved ?? 0),
    signalType: attempt.signalType === "explicit" || attempt.signalType === "heuristic" ? attempt.signalType : "none",
  };
}

function coercePause(value: unknown): ProviderPauseState | null {
  if (!value || typeof value !== "object") return null;
  const pause = value as Partial<ProviderPauseState>;
  if (
    typeof pause.pausedUntil !== "number"
    || !Number.isFinite(pause.pausedUntil)
    || typeof pause.pauseReason !== "string"
    || pause.pauseReason.trim().length === 0
    || (pause.detectedAt !== undefined
      && (typeof pause.detectedAt !== "number" || !Number.isFinite(pause.detectedAt)))
  ) {
    return null;
  }
  return {
    pausedUntil: pause.pausedUntil,
    pauseReason: pause.pauseReason,
    pauseLevel: pause.pauseLevel === 2 || pause.pauseLevel === 3 ? pause.pauseLevel : 1,
    detectedAt: typeof pause.detectedAt === "number" ? pause.detectedAt : Date.now(),
    detectedBy: pause.detectedBy === "manual" ? "manual" : "auto",
  };
}

function inferOutcomeFromSnapshot(
  snapshot: Partial<ProviderHealthSnapshot>,
): HealthOutcome | undefined {
  if (typeof snapshot.lastOutcome === "string") {
    return snapshot.lastOutcome as HealthOutcome;
  }
  if (snapshot.status === "healthy") return "success";
  if (snapshot.status === "paused") {
    const pauseReason = snapshot.pause?.pauseReason?.toLocaleLowerCase() ?? "";
    if (pauseReason.includes("cooling down")) return "cooldown";
    return "provider_rate_limit";
  }
  if (snapshot.status === "degraded") return "error";
  return undefined;
}

function synthesizeProviderAttempts(
  provider: HealthProviderId,
  snapshotLike: Partial<PersistedProviderHealth & ProviderHealthSnapshot>,
): ProviderHealthAttempt[] {
  const attempts: ProviderHealthAttempt[] = [];
  const lastSuccessfulAt =
    typeof snapshotLike.lastSuccessfulAt === "number"
      ? snapshotLike.lastSuccessfulAt
      : undefined;
  const inferredOutcome = inferOutcomeFromSnapshot(snapshotLike);
  const lastAttemptAt =
    typeof snapshotLike.lastAttemptAt === "number"
      ? snapshotLike.lastAttemptAt
      : lastSuccessfulAt;
  const reason =
    typeof snapshotLike.lastError === "string"
      ? snapshotLike.lastError
      : typeof snapshotLike.currentMessage === "string"
        ? snapshotLike.currentMessage
        : snapshotLike.pause?.pauseReason;

  if (
    typeof lastSuccessfulAt === "number" &&
    (inferredOutcome !== "success" || lastAttemptAt !== lastSuccessfulAt)
  ) {
    attempts.push({
      id: `${lastSuccessfulAt}-success`,
      provider,
      scope: "provider",
      outcome: "success",
      startedAt: lastSuccessfulAt,
      finishedAt: lastSuccessfulAt,
      durationMs: 0,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
      signalType: "none",
    });
  }

  if (typeof lastAttemptAt === "number" && inferredOutcome) {
    attempts.push({
      id: `${lastAttemptAt}-${provider}`,
      provider,
      scope: "provider",
      outcome: inferredOutcome,
      reason,
      startedAt: lastAttemptAt,
      finishedAt: lastAttemptAt,
      durationMs: 0,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
      signalType: "none",
    });
  }

  return attempts.sort((a, b) => b.finishedAt - a.finishedAt);
}

function synthesizeFeedAttempts(
  feedUrl: string,
  feedState: Partial<PersistedFeedHealth & RssFeedHealthSnapshot>,
): ProviderHealthAttempt[] {
  const attempts: ProviderHealthAttempt[] = [];
  const lastAttemptAt =
    typeof feedState.lastAttemptAt === "number" ? feedState.lastAttemptAt : undefined;
  const lastSuccessfulAt =
    typeof feedState.lastSuccessfulAt === "number" ? feedState.lastSuccessfulAt : undefined;
  const failedAttemptsSinceSuccess = Math.max(
    0,
    Number(feedState.failedAttemptsSinceSuccess ?? 0),
  );
  const impliedFailureCount =
    failedAttemptsSinceSuccess > 0
      ? failedAttemptsSinceSuccess
      : feedState.status === "failing"
        ? 3
        : 0;

  if (
    impliedFailureCount > 0 &&
    typeof lastAttemptAt === "number"
  ) {
    const outageSince =
      typeof feedState.outageSince === "number"
        ? feedState.outageSince
        : lastSuccessfulAt ?? lastAttemptAt;
    const safeOutageStart =
      typeof lastSuccessfulAt === "number" && outageSince <= lastSuccessfulAt
        ? lastSuccessfulAt + 60_000
        : outageSince;
    const spreadMs = Math.max(60_000, lastAttemptAt - safeOutageStart);
    const stepMs =
      impliedFailureCount > 1
        ? Math.max(60_000, Math.floor(spreadMs / (impliedFailureCount - 1)))
        : 0;

    for (let index = 0; index < impliedFailureCount; index += 1) {
      const finishedAt = lastAttemptAt - stepMs * index;
      attempts.push({
        id: `${finishedAt}-${index}`,
        provider: "rss",
        scope: "rss_feed",
        feedUrl,
        feedTitle: feedState.feedTitle,
        outcome: "error",
        reason: feedState.lastError,
        startedAt: finishedAt,
        finishedAt,
        durationMs: 0,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
        signalType: "none",
      });
    }
  }

  if (typeof lastSuccessfulAt === "number") {
    attempts.push({
      id: `${lastSuccessfulAt}-success`,
      provider: "rss",
      scope: "rss_feed",
      feedUrl,
      feedTitle: feedState.feedTitle,
      outcome: "success",
      startedAt: lastSuccessfulAt,
      finishedAt: lastSuccessfulAt,
      durationMs: 0,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
      signalType: "none",
    });
  }

  if (attempts.length === 0 && typeof lastAttemptAt === "number") {
    attempts.push({
      id: `${lastAttemptAt}-rss`,
      provider: "rss",
      scope: "rss_feed",
      feedUrl,
      feedTitle: feedState.feedTitle,
      outcome: "success",
      startedAt: lastAttemptAt,
      finishedAt: lastAttemptAt,
      durationMs: 0,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
      signalType: "none",
    });
  }

  return attempts.sort((a, b) => b.finishedAt - a.finishedAt);
}

function coercePersistedHealthState(value: unknown): PersistedHealthState {
  const now = Date.now();
  const defaults = createEmptyState(now);
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Partial<PersistedHealthState>;
  const providers: Record<HealthProviderId, PersistedProviderHealth> = {
    ...defaults.providers,
  };
  const rawProviders = (raw.providers ?? {}) as Partial<
    Record<HealthProviderId, Partial<PersistedProviderHealth>>
  >;
  for (const provider of PROVIDERS) {
    const next = rawProviders[provider];
    if (!next) continue;
    const latestAttempts = coerceAttempts(
      next.latestAttempts,
      MAX_PROVIDER_ATTEMPTS,
    );
    providers[provider] = {
      provider,
      dailyBuckets: coerceBuckets(
        next.dailyBuckets,
        defaultDailyBuckets(now),
        "dateKey",
      ),
      hourlyBuckets: coerceBuckets(
        next.hourlyBuckets,
        defaultHourlyBuckets(now),
        "hourKey",
      ),
      latestAttempts:
        latestAttempts.length > 0
          ? latestAttempts.map(compactAttempt)
          : synthesizeProviderAttempts(provider, next).map(compactAttempt),
      pause: coercePause(next.pause),
      lastPauseLevel:
        next.lastPauseLevel === 2 || next.lastPauseLevel === 3
          ? next.lastPauseLevel
          : next.lastPauseLevel === 1
            ? 1
            : undefined,
      lastPauseDetectedAt:
        typeof next.lastPauseDetectedAt === "number"
          ? next.lastPauseDetectedAt
          : undefined,
    };
  }

  const rssFeeds: Record<string, PersistedFeedHealth> = {};
  const rawFeeds = raw.rssFeeds ?? {};
  for (const [feedUrl, feedState] of Object.entries(rawFeeds)) {
    if (!feedState || typeof feedState !== "object") continue;
    const next = feedState as Partial<PersistedFeedHealth>;
    rssFeeds[feedUrl] = {
      feedUrl,
      feedTitle: compactText(
        typeof next.feedTitle === "string" && next.feedTitle.length > 0 ? next.feedTitle : feedUrl,
        MAX_FEED_TITLE_CHARS,
      ) ?? feedUrl,
      dailyBuckets: [],
      hourlyBuckets: [],
      latestAttempts: (() => {
        const latestAttempts = coerceAttempts(next.latestAttempts, MAX_FEED_ATTEMPTS);
        return latestAttempts.length > 0
          ? latestAttempts.map(compactAttempt)
          : synthesizeFeedAttempts(feedUrl, next).map(compactAttempt);
      })(),
    };
  }

  const rawFailingFeeds = (raw as Partial<{ failingRssFeeds: RssFeedHealthSnapshot[] }>).failingRssFeeds;
  if (Array.isArray(rawFailingFeeds)) {
    for (const feedState of rawFailingFeeds) {
      if (!feedState || typeof feedState !== "object" || typeof feedState.feedUrl !== "string") {
        continue;
      }
      rssFeeds[feedState.feedUrl] = {
        feedUrl: feedState.feedUrl,
        feedTitle: compactText(
          typeof feedState.feedTitle === "string" && feedState.feedTitle.length > 0
            ? feedState.feedTitle
            : feedState.feedUrl,
          MAX_FEED_TITLE_CHARS,
        ) ?? feedState.feedUrl,
        dailyBuckets: [],
        hourlyBuckets: [],
        latestAttempts: (() => {
          const latestAttempts = coerceAttempts(feedState.latestAttempts, MAX_FEED_ATTEMPTS);
          return latestAttempts.length > 0
            ? latestAttempts.map(compactAttempt)
            : synthesizeFeedAttempts(feedState.feedUrl, feedState).map(compactAttempt);
        })(),
      };
    }
  }

  return {
    version: 1,
    providers,
    rssFeeds,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const HEALTH_OUTCOMES = new Set<HealthOutcome>([
  "success",
  "empty",
  "error",
  "cooldown",
  "provider_rate_limit",
]);
const HEALTH_SIGNAL_TYPES = new Set<HealthSignalType>([
  "none",
  "explicit",
  "heuristic",
]);
const HEALTH_PROVIDER_IDS = new Set<HealthProviderId>(PROVIDERS);

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalNonNegativeFiniteNumber(value: unknown): boolean {
  return value === undefined || isNonNegativeFiniteNumber(value);
}

function isOptionalStringValue(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isHealthOutcome(value: unknown): value is HealthOutcome {
  return typeof value === "string" && HEALTH_OUTCOMES.has(value as HealthOutcome);
}

function isHealthSignalType(value: unknown): value is HealthSignalType {
  return typeof value === "string"
    && HEALTH_SIGNAL_TYPES.has(value as HealthSignalType);
}

function isPersistedPause(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeFiniteNumber(value.pausedUntil)
    && typeof value.pauseReason === "string"
    && value.pauseReason.trim().length > 0
    && (value.pauseLevel === undefined
      || value.pauseLevel === 1
      || value.pauseLevel === 2
      || value.pauseLevel === 3)
    && isOptionalNonNegativeFiniteNumber(value.detectedAt)
    && (value.detectedBy === undefined
      || value.detectedBy === "auto"
      || value.detectedBy === "manual")
  );
}

function isValidBucketKey(
  value: string,
  key: "dateKey" | "hourKey",
): boolean {
  const expectedPattern = key === "dateKey"
    ? /^\d{4}-\d{2}-\d{2}$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}$/;
  if (!expectedPattern.test(value)) return false;

  const parsed = new Date(
    key === "dateKey"
      ? `${value}T00:00:00.000Z`
      : `${value}:00:00.000Z`,
  );
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, key === "dateKey" ? 10 : 13) === value;
}

function validatePersistedBucket(
  value: unknown,
  key: "dateKey" | "hourKey",
): string | null {
  if (
    !isRecord(value)
    || typeof value[key] !== "string"
    || !isValidBucketKey(value[key], key)
  ) {
    return `has an invalid ${key}`;
  }
  for (const countKey of [
    "attempts",
    "successes",
    "failures",
    "itemsSeen",
    "itemsAdded",
  ] as const) {
    if (!isNonNegativeFiniteNumber(value[countKey])) {
      return `has an invalid ${countKey}`;
    }
  }
  if (
    value.bytesMoved !== undefined
    && !isNonNegativeFiniteNumber(value.bytesMoved)
  ) {
    return "has an invalid bytesMoved";
  }
  return null;
}

function validatePersistedBuckets(
  value: unknown,
  key: "dateKey" | "hourKey",
): string | null {
  if (!Array.isArray(value)) return "must be an array";
  const seenKeys = new Set<string>();
  for (const bucket of value) {
    const error = validatePersistedBucket(bucket, key);
    if (error) return error;
    const bucketKey = (bucket as Record<string, unknown>)[key] as string;
    if (seenKeys.has(bucketKey)) return `has a duplicate ${key}`;
    seenKeys.add(bucketKey);
  }
  return null;
}

function validatePersistedAttempt(
  value: unknown,
  expectedProvider: HealthProviderId,
  expectedFeedUrl?: string,
): string | null {
  if (!isRecord(value)) return "must contain objects";
  if (typeof value.id !== "string" || value.id.length === 0) {
    return "has an invalid id";
  }
  if (
    typeof value.provider !== "string"
    || !HEALTH_PROVIDER_IDS.has(value.provider as HealthProviderId)
    || value.provider !== expectedProvider
  ) {
    return "has an invalid provider";
  }
  const expectedScope = expectedProvider === "rss" ? "rss_feed" : "provider";
  const isLegacyRssBatchScope = expectedProvider === "rss"
    && value.scope === "provider"
    && value.feedUrl === undefined;
  if (value.scope !== expectedScope && !isLegacyRssBatchScope) {
    return "has an invalid scope";
  }
  if (!isHealthOutcome(value.outcome)) return "has an invalid outcome";
  if (
    !isOptionalStringValue(value.feedUrl)
    || !isOptionalStringValue(value.feedTitle)
    || !isOptionalStringValue(value.stage)
    || !isOptionalStringValue(value.reason)
  ) {
    return "has an invalid optional text field";
  }
  if (
    expectedFeedUrl !== undefined
    && (typeof value.feedUrl !== "string" || value.feedUrl.length === 0)
  ) {
    return "is missing its RSS feed URL";
  }
  if (expectedFeedUrl !== undefined && value.feedUrl !== expectedFeedUrl) {
    return "does not match its RSS feed";
  }
  for (const numberKey of [
    "startedAt",
    "finishedAt",
    "durationMs",
    "itemsSeen",
    "itemsAdded",
    "bytesMoved",
  ] as const) {
    if (!isNonNegativeFiniteNumber(value[numberKey])) {
      return `has an invalid ${numberKey}`;
    }
  }
  if (!isHealthSignalType(value.signalType)) {
    return "has an invalid signalType";
  }
  return null;
}

function validatePersistedAttempts(
  value: unknown,
  expectedProvider: HealthProviderId,
  expectedFeedUrl?: string,
  maxAttempts?: number,
): string | null {
  if (!Array.isArray(value)) return "must be an array";
  if (maxAttempts !== undefined && value.length > maxAttempts) {
    return `contains more than ${maxAttempts.toLocaleString()} attempts`;
  }
  for (const attempt of value) {
    const error = validatePersistedAttempt(
      attempt,
      expectedProvider,
      expectedFeedUrl,
    );
    if (error) return error;
  }
  return null;
}

const LEGACY_PROVIDER_KEYS = [
  "status",
  "lastAttemptAt",
  "lastSuccessfulAt",
  "lastOutcome",
  "lastError",
  "currentMessage",
  "totalSeen7d",
  "totalAdded7d",
  "totalBytes7d",
] as const;

function isLegacyProviderRecord(value: Record<string, unknown>): boolean {
  return LEGACY_PROVIDER_KEYS.some((key) => hasOwn(value, key));
}

function validateLegacyProviderFields(value: Record<string, unknown>): string | null {
  if (
    value.status !== undefined
    && value.status !== "idle"
    && value.status !== "healthy"
    && value.status !== "degraded"
    && value.status !== "paused"
  ) {
    return "has an invalid legacy status";
  }
  if (!isOptionalNonNegativeFiniteNumber(value.lastAttemptAt)) {
    return "has an invalid legacy lastAttemptAt";
  }
  if (!isOptionalNonNegativeFiniteNumber(value.lastSuccessfulAt)) {
    return "has an invalid legacy lastSuccessfulAt";
  }
  if (value.lastOutcome !== undefined && !isHealthOutcome(value.lastOutcome)) {
    return "has an invalid legacy lastOutcome";
  }
  if (
    !isOptionalStringValue(value.lastError)
    || !isOptionalStringValue(value.currentMessage)
  ) {
    return "has invalid legacy error text";
  }
  for (const countKey of [
    "totalSeen7d",
    "totalAdded7d",
    "totalBytes7d",
  ] as const) {
    if (!isOptionalNonNegativeFiniteNumber(value[countKey])) {
      return `has an invalid legacy ${countKey}`;
    }
  }
  return null;
}

function validatePersistedProvider(
  provider: HealthProviderId,
  value: unknown,
  allowLegacy: boolean,
): string | null {
  if (!isRecord(value)) return "must contain an object";
  const legacy = allowLegacy && isLegacyProviderRecord(value);
  if (!legacy) {
    if (value.provider !== provider) return "has an invalid provider id";
    if (!hasOwn(value, "dailyBuckets")) return "is missing dailyBuckets";
    if (!hasOwn(value, "hourlyBuckets")) return "is missing hourlyBuckets";
    if (!hasOwn(value, "latestAttempts")) return "is missing latestAttempts";
    if (!hasOwn(value, "pause")) return "is missing pause";
  } else {
    if (value.provider !== undefined && value.provider !== provider) {
      return "has an invalid legacy provider id";
    }
    const legacyError = validateLegacyProviderFields(value);
    if (legacyError) return legacyError;
  }

  if (value.dailyBuckets !== undefined) {
    const error = validatePersistedBuckets(value.dailyBuckets, "dateKey");
    if (error) return `has invalid dailyBuckets: ${error}`;
  }
  if (value.hourlyBuckets !== undefined) {
    const error = validatePersistedBuckets(value.hourlyBuckets, "hourKey");
    if (error) return `has invalid hourlyBuckets: ${error}`;
  }
  if (value.latestAttempts !== undefined) {
    const error = validatePersistedAttempts(
      value.latestAttempts,
      provider,
      undefined,
      legacy ? undefined : MAX_PROVIDER_ATTEMPTS,
    );
    if (error) return `has invalid latestAttempts: ${error}`;
  }
  if (value.pause !== undefined && value.pause !== null && !isPersistedPause(value.pause)) {
    return "has an invalid pause";
  }
  if (
    value.lastPauseLevel !== undefined
    && value.lastPauseLevel !== 1
    && value.lastPauseLevel !== 2
    && value.lastPauseLevel !== 3
  ) {
    return "has an invalid lastPauseLevel";
  }
  if (!isOptionalNonNegativeFiniteNumber(value.lastPauseDetectedAt)) {
    return "has an invalid lastPauseDetectedAt";
  }
  return null;
}

function validatePersistedRssFeed(
  feedUrl: string,
  value: unknown,
): string | null {
  if (!isRecord(value)) return "must contain an object";
  if (value.feedUrl !== feedUrl) return "has an invalid feedUrl";
  if (typeof value.feedTitle !== "string" || value.feedTitle.length === 0) {
    return "has an invalid feedTitle";
  }
  const dailyError = validatePersistedBuckets(value.dailyBuckets, "dateKey");
  if (dailyError) return `has invalid dailyBuckets: ${dailyError}`;
  const hourlyError = validatePersistedBuckets(value.hourlyBuckets, "hourKey");
  if (hourlyError) return `has invalid hourlyBuckets: ${hourlyError}`;
  const attemptsError = validatePersistedAttempts(
    value.latestAttempts,
    "rss",
    feedUrl,
    MAX_FEED_ATTEMPTS,
  );
  return attemptsError
    ? `has invalid latestAttempts: ${attemptsError}`
    : null;
}

function validateLegacyRssFeed(value: unknown): string | null {
  if (!isRecord(value)) return "must contain objects";
  if (typeof value.feedUrl !== "string" || value.feedUrl.length === 0) {
    return "has an invalid feedUrl";
  }
  if (
    value.feedTitle !== undefined
    && (typeof value.feedTitle !== "string" || value.feedTitle.length === 0)
  ) {
    return "has an invalid feedTitle";
  }
  if (
    value.status !== undefined
    && value.status !== "ok"
    && value.status !== "failing"
  ) {
    return "has an invalid status";
  }
  for (const timestampKey of [
    "outageSince",
    "lastAttemptAt",
    "lastSuccessfulAt",
  ] as const) {
    if (!isOptionalNonNegativeFiniteNumber(value[timestampKey])) {
      return `has an invalid ${timestampKey}`;
    }
  }
  if (!isOptionalStringValue(value.lastError)) return "has an invalid lastError";
  if (
    value.failedAttemptsSinceSuccess !== undefined
    && (
      !Number.isSafeInteger(value.failedAttemptsSinceSuccess)
      || (value.failedAttemptsSinceSuccess as number) < 0
    )
  ) {
    return "has an invalid failedAttemptsSinceSuccess";
  }
  if (value.dailyBuckets !== undefined) {
    const error = validatePersistedBuckets(value.dailyBuckets, "dateKey");
    if (error) return `has invalid dailyBuckets: ${error}`;
  }
  if (value.hourlyBuckets !== undefined) {
    const error = validatePersistedBuckets(value.hourlyBuckets, "hourKey");
    if (error) return `has invalid hourlyBuckets: ${error}`;
  }
  if (value.latestAttempts !== undefined) {
    const error = validatePersistedAttempts(
      value.latestAttempts,
      "rss",
      value.feedUrl,
    );
    if (error) return `has invalid latestAttempts: ${error}`;
  }
  return null;
}

function validatePersistedHealthState(value: Record<string, unknown>): string | null {
  if (!isRecord(value.providers)) return "has an invalid providers field";
  const providerRecords = value.providers;
  const hasLegacyFeeds = hasOwn(value, "failingRssFeeds");
  const providerKeys = Object.keys(providerRecords);
  const hasLegacyVersionOneProviderSet =
    !hasLegacyFeeds
    && providerKeys.length === LEGACY_VERSION_ONE_PROVIDERS.size
    && providerKeys.every((provider) =>
      LEGACY_VERSION_ONE_PROVIDERS.has(provider as HealthProviderId),
    );
  if (!hasLegacyFeeds && !hasLegacyVersionOneProviderSet) {
    for (const provider of PROVIDERS) {
      if (!hasOwn(providerRecords, provider)) {
        return `is missing its ${provider} provider record`;
      }
    }
    for (const provider of Object.keys(providerRecords)) {
      if (!HEALTH_PROVIDER_IDS.has(provider as HealthProviderId)) {
        return `has an unknown ${provider} provider record`;
      }
    }
  }
  let recognizedProviderCount = 0;
  for (const provider of PROVIDERS) {
    const providerValue = providerRecords[provider];
    if (providerValue === undefined) continue;
    recognizedProviderCount += 1;
    const error = validatePersistedProvider(
      provider,
      providerValue,
      hasLegacyFeeds,
    );
    if (error) return `has an invalid ${provider} provider record: ${error}`;
  }
  if (recognizedProviderCount === 0) return "has no recognized provider records";

  if (!hasLegacyFeeds) {
    if (!hasOwn(value, "rssFeeds")) return "is missing rssFeeds";
    if (!hasOwn(value, "updatedAt")) return "is missing updatedAt";
  }
  if (value.rssFeeds !== undefined) {
    if (!isRecord(value.rssFeeds)) return "has an invalid rssFeeds field";
    for (const [feedUrl, feedState] of Object.entries(value.rssFeeds)) {
      const error = validatePersistedRssFeed(feedUrl, feedState);
      if (error) return `has an invalid RSS feed record: ${error}`;
    }
  }
  if (value.failingRssFeeds !== undefined) {
    if (!Array.isArray(value.failingRssFeeds)) {
      return "has an invalid legacy failingRssFeeds field";
    }
    for (const feedState of value.failingRssFeeds) {
      const error = validateLegacyRssFeed(feedState);
      if (error) return `has an invalid legacy RSS feed record: ${error}`;
    }
  }
  if (!isOptionalNonNegativeFiniteNumber(value.updatedAt)) {
    return "has an invalid updatedAt";
  }
  return null;
}

function failedHealthRead(
  status: HealthStorageIssue["status"],
  source: HealthStorageIssue["source"],
  reason: string,
  raw: string | null,
): HealthStateReadResult {
  const issue = createStorageIssue(status, source, reason, raw);
  return {
    status,
    state: createEmptyState(issue.detectedAt),
    issue,
  };
}

function decodeHealthRaw(
  raw: string,
  source: HealthStorageIssue["source"],
): HealthStateReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failedHealthRead(
      "corrupt",
      source,
      error instanceof Error ? error.message : String(error),
      raw,
    );
  }

  if (!isRecord(parsed)) {
    return failedHealthRead(
      "corrupt",
      source,
      "The provider health store must contain an object.",
      raw,
    );
  }

  const storedValue = Object.prototype.hasOwnProperty.call(parsed, HEALTH_STORE_KEY)
    ? parsed[HEALTH_STORE_KEY]
    : parsed;
  if (!isRecord(storedValue)) {
    return failedHealthRead(
      "corrupt",
      source,
      "The provider health record must contain an object.",
      raw,
    );
  }

  const version = storedValue.version;
  if (version !== 1) {
    const isFutureVersion = typeof version === "number"
      && Number.isSafeInteger(version)
      && version > 1;
    return failedHealthRead(
      isFutureVersion ? "unsupported" : "corrupt",
      source,
      isFutureVersion
        ? `Provider health version ${version.toLocaleString()} is newer than this app supports.`
        : "The provider health record has an invalid version.",
      raw,
    );
  }

  const validationError = validatePersistedHealthState(storedValue);
  if (validationError) {
    return failedHealthRead(
      "corrupt",
      source,
      `The provider health record ${validationError}.`,
      raw,
    );
  }

  return {
    status: "supported",
    state: coercePersistedHealthState(storedValue),
    issue: null,
  };
}

function compactPersistedHealthState(state: PersistedHealthState): PersistedHealthState {
  for (const provider of PROVIDERS) {
    state.providers[provider] = {
      ...state.providers[provider],
      latestAttempts: state.providers[provider].latestAttempts
        .map(compactAttempt)
        .slice(0, MAX_PROVIDER_ATTEMPTS),
    };
  }

  for (const [feedUrl, feedState] of Object.entries(state.rssFeeds)) {
    state.rssFeeds[feedUrl] = {
      ...feedState,
      feedTitle: compactText(feedState.feedTitle, MAX_FEED_TITLE_CHARS) ?? feedUrl,
      dailyBuckets: [],
      hourlyBuckets: [],
      latestAttempts: feedState.latestAttempts
        .map(compactAttempt)
        .slice(0, MAX_FEED_ATTEMPTS),
    };
  }

  return state;
}

function bucketSuccess(outcome: HealthOutcome): boolean {
  return outcome === "success";
}

function bumpDailyBuckets(
  buckets: HealthDailyBucket[],
  finishedAt: number,
  outcome: HealthOutcome,
  itemsSeen: number,
  itemsAdded: number,
  bytesMoved: number,
): HealthDailyBucket[] {
  const next = coerceBuckets(
    buckets,
    defaultDailyBuckets(finishedAt),
    "dateKey",
  );
  const dateKey = new Date(finishedAt).toISOString().slice(0, 10);
  return next.map((bucket) =>
    bucket.dateKey !== dateKey
      ? bucket
      : {
          ...bucket,
          attempts: bucket.attempts + 1,
          successes: bucket.successes + (bucketSuccess(outcome) ? 1 : 0),
          failures: bucket.failures + (bucketSuccess(outcome) ? 0 : 1),
          itemsSeen: bucket.itemsSeen + itemsSeen,
          itemsAdded: bucket.itemsAdded + itemsAdded,
          bytesMoved: bucket.bytesMoved + bytesMoved,
        },
  );
}

function bumpHourlyBuckets(
  buckets: HealthHourlyBucket[],
  finishedAt: number,
  outcome: HealthOutcome,
  itemsSeen: number,
  itemsAdded: number,
  bytesMoved: number,
): HealthHourlyBucket[] {
  const next = coerceBuckets(
    buckets,
    defaultHourlyBuckets(finishedAt),
    "hourKey",
  );
  const hourKey = new Date(finishedAt).toISOString().slice(0, 13);
  return next.map((bucket) =>
    bucket.hourKey !== hourKey
      ? bucket
      : {
          ...bucket,
          attempts: bucket.attempts + 1,
          successes: bucket.successes + (bucketSuccess(outcome) ? 1 : 0),
          failures: bucket.failures + (bucketSuccess(outcome) ? 0 : 1),
          itemsSeen: bucket.itemsSeen + itemsSeen,
          itemsAdded: bucket.itemsAdded + itemsAdded,
          bytesMoved: bucket.bytesMoved + bytesMoved,
        },
  );
}

function upsertAttempt(
  attempts: ProviderHealthAttempt[],
  attempt: ProviderHealthAttempt,
  max: number,
): ProviderHealthAttempt[] {
  const compactedAttempt = compactAttempt(attempt);
  return [
    compactedAttempt,
    ...attempts
      .filter((existing) => existing.id !== compactedAttempt.id)
      .map(compactAttempt),
  ].slice(0, max);
}

function clearExpiredPause(providerState: PersistedProviderHealth, now = Date.now()): PersistedProviderHealth {
  if (!providerState.pause || providerState.pause.pausedUntil > now) {
    return providerState;
  }
  return {
    ...providerState,
    pause: null,
  };
}

function lastSuccessfulAt(attempts: ProviderHealthAttempt[]): number | undefined {
  return attempts.find((attempt) => bucketSuccess(attempt.outcome))?.finishedAt;
}

function recentFailuresForHeuristic(
  attempts: ProviderHealthAttempt[],
  now: number,
): number {
  return attempts.filter((attempt) => {
    if (bucketSuccess(attempt.outcome)) return false;
    if (now - attempt.finishedAt > RATE_LIMIT_HEURISTIC_WINDOW_MS) return false;
    return attempt.stage === "timeout" || attempt.stage === "extract" || attempt.stage === "empty";
  }).length;
}

function hadHealthySyncInLast7Days(
  attempts: ProviderHealthAttempt[],
  now: number,
): boolean {
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  return attempts.some(
    (attempt) =>
      bucketSuccess(attempt.outcome) && now - attempt.finishedAt <= windowMs,
  );
}

function nextPause(
  providerState: PersistedProviderHealth,
  reason: string,
  detectedBy: "auto" | "manual",
  now: number,
): ProviderPauseState {
  const withinWindow =
    !!providerState.lastPauseDetectedAt &&
    now - providerState.lastPauseDetectedAt <= 7 * 24 * 60 * 60 * 1000;
  const pauseLevel = withinWindow
    ? (Math.min((providerState.lastPauseLevel ?? 1) + 1, 3) as 1 | 2 | 3)
    : 1;
  const pauseHours = PAUSE_HOURS[pauseLevel - 1];
  return {
    pausedUntil: now + pauseHours * 60 * 60 * 1000,
    pauseReason: reason,
    pauseLevel,
    detectedAt: now,
    detectedBy,
  };
}

function formatPauseToast(provider: HealthProviderId, pause: ProviderPauseState): string {
  const label = {
    x: "X",
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    substack: "Substack",
    medium: "Medium",
    youtube: "YouTube",
    rss: "RSS",
    gdrive: "Google Drive",
    dropbox: "Dropbox",
  }[provider];
  const hours = Math.round((pause.pausedUntil - pause.detectedAt) / (60 * 60 * 1000));
  return `${label} may be rate limiting sync. Paused for ${hours.toLocaleString()} hour${hours === 1 ? "" : "s"}.`;
}

function syncPauseToAuth(provider: HealthProviderId, pause: ProviderPauseState | null): void {
  const store = useAppStore.getState();
  if (provider === "x") {
    const current = store.xAuth;
    store.setXAuth({
      ...current,
      pausedUntil: pause?.pausedUntil,
      pauseReason: pause?.pauseReason,
      pauseLevel: pause?.pauseLevel,
    });
    return;
  }
  if (provider === "facebook") {
    const next = {
      ...store.fbAuth,
      pausedUntil: pause?.pausedUntil,
      pauseReason: pause?.pauseReason,
      pauseLevel: pause?.pauseLevel,
    };
    store.setFbAuth(next);
    storeFbAuthState(next);
    return;
  }
  if (provider === "instagram") {
    const next = {
      ...store.igAuth,
      pausedUntil: pause?.pausedUntil,
      pauseReason: pause?.pauseReason,
      pauseLevel: pause?.pauseLevel,
    };
    store.setIgAuth(next);
    storeIgAuthState(next);
    return;
  }
  if (provider === "linkedin") {
    const next = {
      ...store.liAuth,
      pausedUntil: pause?.pausedUntil,
      pauseReason: pause?.pauseReason,
      pauseLevel: pause?.pauseLevel,
      lastCapturedAt: pause ? store.liAuth.lastCapturedAt : store.liAuth.lastCapturedAt,
      lastCaptureError: pause ? store.liAuth.lastCaptureError : store.liAuth.lastCaptureError,
    };
    store.setLiAuth(next);
    storeLiAuthState(next);
    return;
  }
  if (provider === "substack") {
    const next = {
      ...store.substackAuth,
      pausedUntil: pause?.pausedUntil,
      pauseReason: pause?.pauseReason,
      pauseLevel: pause?.pauseLevel,
    };
    store.setSubstackAuth(next);
    storeSubstackAuthState(next);
    return;
  }
  if (provider === "medium") {
    const next = {
      ...store.mediumAuth,
      pausedUntil: pause?.pausedUntil,
      pauseReason: pause?.pauseReason,
      pauseLevel: pause?.pauseLevel,
    };
    store.setMediumAuth(next);
    storeMediumAuthState(next);
    return;
  }
  if (provider === "youtube") {
    const next = {
      ...store.ytAuth,
      pausedUntil: pause?.pausedUntil,
      pauseReason: pause?.pauseReason,
      pauseLevel: pause?.pauseLevel,
    };
    store.setYtAuth(next);
    storeYouTubeAuthState(next);
  }
}

function storageBlocksAutomaticProviderWork(): boolean {
  return healthStorageStatus !== "supported";
}

function storageBlockPause(provider: HealthProviderId): ProviderPauseState | null {
  if (!SOCIAL_PROVIDERS.has(provider) || !storageBlocksAutomaticProviderWork()) {
    return null;
  }
  const detectedAt = healthStorageIssue?.detectedAt ?? Date.now();
  return {
    pausedUntil: detectedAt + STORAGE_BLOCK_PAUSE_MS,
    pauseReason: STORAGE_BLOCK_MESSAGE,
    pauseLevel: 1,
    detectedAt,
    detectedBy: "auto",
  };
}

function withStorageBlockPause(
  providerState: PersistedProviderHealth,
): PersistedProviderHealth {
  const pause = storageBlockPause(providerState.provider);
  return pause ? { ...providerState, pause } : providerState;
}

function providerStatus(providerState: PersistedProviderHealth): ProviderHealthSnapshot["status"] {
  const currentPause = providerState.pause;
  if (currentPause && currentPause.pausedUntil > Date.now()) return "paused";
  const latest = latestStatusAttempt(providerState);
  if (!latest) return "idle";
  if (bucketSuccess(latest.outcome)) return "healthy";
  return "degraded";
}

function messageFor(providerState: PersistedProviderHealth): string | undefined {
  if (providerState.pause && providerState.pause.pausedUntil > Date.now()) {
    return formatProviderStatusMessage(providerState.pause.pauseReason);
  }
  const latest = latestStatusAttempt(providerState);
  if (!latest) return undefined;
  if (latest.outcome === "success") return undefined;
  if (latest.reason) return formatProviderStatusMessage(latest.reason);
  if (latest.outcome === "cooldown") return "Cooling down";
  if (latest.outcome === "provider_rate_limit") return "Rate limit detected";
  if (latest.outcome === "empty") return "No posts pulled";
  return "Needs attention";
}

function isMemoryPressureAttempt(attempt: ProviderHealthAttempt): boolean {
  const reason = attempt.reason?.toLocaleLowerCase() ?? "";
  return (
    attempt.stage === "memory_pressure" ||
    (reason.includes("memory") &&
      (reason.includes("is high") || reason.includes("remains critically high")) &&
      reason.includes("after cleanup"))
  );
}

function isRuntimeDeferredAttempt(attempt: ProviderHealthAttempt): boolean {
  const reason = attempt.reason?.toLocaleLowerCase() ?? "";
  return (
    attempt.stage === "runtime_deferred" ||
    reason.includes("runtime_deferred") ||
    reason.includes("renderer safe mode") ||
    reason.includes("background work is paused") ||
    reason.includes("background work is cooling down") ||
    reason.includes("app window to report healthy") ||
    reason.includes("app recovers")
  );
}

function isTransientStatusAttempt(attempt: ProviderHealthAttempt): boolean {
  return isMemoryPressureAttempt(attempt) || isRuntimeDeferredAttempt(attempt);
}

function latestStatusAttempt(
  providerState: PersistedProviderHealth,
  now = Date.now(),
): ProviderHealthAttempt | undefined {
  return providerState.latestAttempts.find((attempt) => {
    if (!isTransientStatusAttempt(attempt)) return true;
    return now - attempt.finishedAt <= TRANSIENT_MEMORY_PRESSURE_STATUS_MS;
  });
}

function snapshotForProvider(providerState: PersistedProviderHealth): ProviderHealthSnapshot {
  const effectiveState = withStorageBlockPause(providerState);
  const latestAttempt = latestStatusAttempt(effectiveState);
  const latestWasSuccessful = !!latestAttempt && bucketSuccess(latestAttempt.outcome);
  return {
    provider: effectiveState.provider,
    status: providerStatus(effectiveState),
    lastAttemptAt: latestAttempt?.finishedAt,
    lastSuccessfulAt: lastSuccessfulAt(effectiveState.latestAttempts),
    lastOutcome: latestAttempt?.outcome,
    lastError: latestWasSuccessful ? undefined : formatProviderStatusMessage(latestAttempt?.reason),
    currentMessage: messageFor(effectiveState),
    pause: effectiveState.pause,
    dailyBuckets: effectiveState.dailyBuckets,
    hourlyBuckets: effectiveState.hourlyBuckets,
    latestAttempts: effectiveState.latestAttempts,
    totalSeen7d: effectiveState.dailyBuckets.reduce(
      (sum, bucket) => sum + bucket.itemsSeen,
      0,
    ),
    totalAdded7d: effectiveState.dailyBuckets.reduce(
      (sum, bucket) => sum + bucket.itemsAdded,
      0,
    ),
    totalBytes7d: effectiveState.dailyBuckets.reduce(
      (sum, bucket) => sum + bucket.bytesMoved,
      0,
    ),
  };
}

function dailyBucketsForFeed(feedState: PersistedFeedHealth): HealthDailyBucket[] {
  return [...feedState.latestAttempts]
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .reduce(
      (buckets, attempt) =>
        bumpDailyBuckets(
          buckets,
          attempt.finishedAt,
          attempt.outcome,
          attempt.itemsSeen,
          attempt.itemsAdded,
          attempt.bytesMoved,
        ),
      defaultDailyBuckets(),
    );
}

function hourlyBucketsForFeed(feedState: PersistedFeedHealth): HealthHourlyBucket[] {
  return [...feedState.latestAttempts]
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .reduce(
      (buckets, attempt) =>
        bumpHourlyBuckets(
          buckets,
          attempt.finishedAt,
          attempt.outcome,
          attempt.itemsSeen,
          attempt.itemsAdded,
          attempt.bytesMoved,
        ),
      defaultHourlyBuckets(),
    );
}

function snapshotForFeed(feedState: PersistedFeedHealth): RssFeedHealthSnapshot {
  const lastSuccess = feedState.latestAttempts.find((attempt) => bucketSuccess(attempt.outcome));
  const failedSinceSuccess = feedState.latestAttempts.filter((attempt) => {
    if (bucketSuccess(attempt.outcome)) return false;
    if (!lastSuccess) return true;
    return attempt.finishedAt > lastSuccess.finishedAt;
  });
  const outageSince = failedSinceSuccess.length
    ? failedSinceSuccess[failedSinceSuccess.length - 1].finishedAt
    : undefined;
  const failing =
    !!outageSince &&
    Date.now() - outageSince >= FAILING_FEED_OUTAGE_MS &&
    failedSinceSuccess.length >= 3;

  return {
    feedUrl: feedState.feedUrl,
    feedTitle: feedState.feedTitle,
    status: failing ? "failing" : "ok",
    outageSince,
    failedAttemptsSinceSuccess: failedSinceSuccess.length,
    lastAttemptAt: feedState.latestAttempts[0]?.finishedAt,
    lastSuccessfulAt: lastSuccess?.finishedAt,
    lastError: feedState.latestAttempts.find(
      (attempt) => !bucketSuccess(attempt.outcome) && attempt.reason,
    )?.reason,
    dailyBuckets: feedState.dailyBuckets.length > 0
      ? feedState.dailyBuckets
      : dailyBucketsForFeed(feedState),
    hourlyBuckets: feedState.hourlyBuckets.length > 0
      ? feedState.hourlyBuckets
      : hourlyBucketsForFeed(feedState),
    latestAttempts: feedState.latestAttempts,
  };
}

function computeFailingRssFeeds(state: PersistedHealthState): RssFeedHealthSnapshot[] {
  return Object.values(state.rssFeeds)
    .map(snapshotForFeed)
    .filter((feed) => feed.status === "failing")
    .sort((a, b) => {
      const aOutage = a.outageSince ?? 0;
      const bOutage = b.outageSince ?? 0;
      return aOutage - bOutage;
    });
}

function updateFailingRssFeed(
  state: PersistedHealthState,
  feedUrl: string,
): RssFeedHealthSnapshot[] {
  const next = latestFailingRssFeeds.filter((feed) => feed.feedUrl !== feedUrl);
  const feedState = state.rssFeeds[feedUrl];
  if (feedState) {
    const feedSnapshot = snapshotForFeed(feedState);
    if (feedSnapshot.status === "failing") {
      next.push(feedSnapshot);
    }
  }
  return next.sort((a, b) => {
    const aOutage = a.outageSince ?? 0;
    const bOutage = b.outageSince ?? 0;
    return aOutage - bOutage;
  });
}

function publishState(state: PersistedHealthState, changedFeedUrl?: string): void {
  const providers = Object.fromEntries(
    PROVIDERS.map((provider) => [provider, snapshotForProvider(state.providers[provider])]),
  ) as Record<HealthProviderId, ProviderHealthSnapshot>;
  latestFailingRssFeeds = changedFeedUrl
    ? updateFailingRssFeed(state, changedFeedUrl)
    : computeFailingRssFeeds(state);

  setProviderHealth({
    providers,
    failingRssFeeds: latestFailingRssFeeds,
    updatedAt: state.updatedAt,
  });
}

async function persistState(state: PersistedHealthState): Promise<boolean> {
  if (healthStorageStatus !== "supported" && healthStorageStatus !== "missing") {
    return false;
  }
  const compactedState = compactPersistedHealthState(state);
  const persisted = isTauri()
    ? await persistNativeState(compactedState)
    : fallbackWrite(compactedState);
  if (persisted) {
    healthStorageStatus = "supported";
    healthStorageIssue = null;
    return true;
  }

  healthStorageStatus = "unavailable";
  healthStorageIssue = createStorageIssue(
    "unavailable",
    isTauri() ? "native" : "fallback",
    "The provider health record could not be persisted.",
    null,
  );
  if (currentState) publishState(currentState);
  return false;
}

function readFallbackState(): HealthStateReadResult {
  const fallback = readFallbackRaw();
  if (fallback.status === "available") {
    return decodeHealthRaw(fallback.raw, fallback.source);
  }
  if (fallback.status === "unavailable") {
    return {
      status: "unavailable",
      state: createEmptyState(fallback.issue.detectedAt),
      issue: fallback.issue,
    };
  }
  return {
    status: "missing",
    state: createEmptyState(),
    issue: null,
  };
}

async function readState(): Promise<HealthStateReadResult> {
  if (!isTauri()) {
    return readFallbackState();
  }

  let raw: string | null;
  try {
    raw = await readNativeJsonFileRaw(HEALTH_STORE_FILE);
  } catch (error) {
    return failedHealthRead(
      "unavailable",
      "native",
      error instanceof Error ? error.message : String(error),
      null,
    );
  }

  if (raw !== null) return decodeHealthRaw(raw, "native");
  return readFallbackState();
}

async function persistNativeState(state: PersistedHealthState): Promise<boolean> {
  try {
    await writeNativeJsonFile(HEALTH_STORE_FILE, { [HEALTH_STORE_KEY]: state }, "provider-health");
    return true;
  } catch (error) {
    log.error(
      `[provider-health] failed to persist health file, falling back: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    fallbackWrite(state);
    return false;
  }
}

function persistStateAndLog(state: PersistedHealthState): void {
  void persistState(state).catch((error) => {
    log.error(
      `[provider-health] failed to persist deferred health state: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

function schedulePersistState(state: PersistedHealthState): void {
  pendingPersistState = state;
  if (pendingPersistTimer) return;
  pendingPersistTimer = setTimeout(() => {
    pendingPersistTimer = null;
    const stateToPersist = pendingPersistState;
    pendingPersistState = null;
    if (stateToPersist) {
      persistStateAndLog(stateToPersist);
    }
  }, RSS_HEALTH_PERSIST_DEBOUNCE_MS);
}

async function persistStateNow(state: PersistedHealthState): Promise<boolean> {
  if (pendingPersistTimer) {
    clearTimeout(pendingPersistTimer);
    pendingPersistTimer = null;
  }
  pendingPersistState = null;
  return persistState(state);
}

function assertState(): PersistedHealthState {
  if (!currentState) {
    currentState = createEmptyState();
  }
  return currentState;
}

function maybeAutoPause(
  state: PersistedHealthState,
  attempt: ProviderHealthAttempt,
): PersistedHealthState {
  if (!SOCIAL_PROVIDERS.has(attempt.provider)) return state;
  const providerState = clearExpiredPause(state.providers[attempt.provider], attempt.finishedAt);
  if (bucketSuccess(attempt.outcome)) {
    if (providerState.pause) {
      syncPauseToAuth(attempt.provider, null);
    }
    state.providers[attempt.provider] = {
      ...providerState,
      pause: null,
      lastPauseLevel: undefined,
      lastPauseDetectedAt: undefined,
    };
    return state;
  }
  if (providerState.pause && providerState.pause.pausedUntil > attempt.finishedAt) {
    state.providers[attempt.provider] = providerState;
    return state;
  }

  let pauseReason: string | null = null;
  if (attempt.outcome === "provider_rate_limit") {
    pauseReason = attempt.reason ?? "Rate limit detected";
  } else if (
    (attempt.outcome === "error" || attempt.outcome === "empty") &&
    hadHealthySyncInLast7Days(providerState.latestAttempts, attempt.finishedAt) &&
    recentFailuresForHeuristic(providerState.latestAttempts, attempt.finishedAt) >= 3
  ) {
    pauseReason = "Repeated failures suggest rate limiting";
  }

  if (!pauseReason) {
    state.providers[attempt.provider] = providerState;
    return state;
  }

  const pause = nextPause(providerState, pauseReason, "auto", attempt.finishedAt);
  state.providers[attempt.provider] = {
    ...providerState,
    pause,
    lastPauseLevel: pause.pauseLevel,
    lastPauseDetectedAt: pause.detectedAt,
  };
  syncPauseToAuth(attempt.provider, pause);
  toast.info(formatPauseToast(attempt.provider, pause), {
    actionLabel: "Open settings",
    onAction: () => {
      useSettingsStore.getState().openTo(
        attempt.provider === "x" ? "x" : attempt.provider,
      );
    },
  });
  return state;
}

function normalizeAttempt(input: ProviderHealthEventInput): ProviderHealthAttempt {
  const startedAt = input.startedAt ?? Date.now();
  const finishedAt = input.finishedAt ?? Date.now();
  return {
    id: `${finishedAt}-${Math.random().toString(36).slice(2, 7)}`,
    provider: input.provider,
    scope: input.provider === "rss" ? "rss_feed" : "provider",
    feedUrl: input.feedUrl,
    feedTitle: input.feedTitle,
    outcome: input.outcome,
    stage: input.stage,
    reason: input.reason,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    itemsSeen: input.itemsSeen ?? 0,
    itemsAdded: input.itemsAdded ?? 0,
    bytesMoved: input.bytesMoved ?? 0,
    signalType: input.signalType ?? "none",
  };
}

async function preserveHealthStorageIssue(issue: HealthStorageIssue): Promise<void> {
  recoverySequence += 1;
  const recoveryFile = `sync-health.recovery.${Date.now()}.${recoverySequence}.json`;
  await writeNativeJsonFile(
    recoveryFile,
    {
      version: 1,
      capturedAt: Date.now(),
      originalFile: HEALTH_STORE_FILE,
      status: issue.status,
      source: issue.source,
      reason: issue.reason,
      raw: issue.raw,
    },
    "provider-health-recovery",
  );
}

async function replaceUnsafeHealthStorage(state: PersistedHealthState): Promise<void> {
  const issue = healthStorageIssue;
  if (!issue) {
    throw new Error("Provider health storage is blocked without recovery evidence.");
  }
  await preserveHealthStorageIssue(issue);

  if (pendingPersistTimer) {
    clearTimeout(pendingPersistTimer);
    pendingPersistTimer = null;
  }
  pendingPersistState = null;

  const compactedState = compactPersistedHealthState(state);
  if (isTauri()) {
    await writeNativeJsonFile(
      HEALTH_STORE_FILE,
      { [HEALTH_STORE_KEY]: compactedState },
      "provider-health-repair",
    );
  } else if (!fallbackWrite(compactedState)) {
    throw new Error("Provider health storage could not be repaired.");
  }

  healthStorageStatus = "supported";
  healthStorageIssue = null;
}

export async function initProviderHealth(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const readResult = await readState();
      healthStorageStatus = readResult.status;
      healthStorageIssue = readResult.issue;
      currentState = compactPersistedHealthState(readResult.state);
      for (const provider of PROVIDERS) {
        currentState.providers[provider] = clearExpiredPause(
          currentState.providers[provider],
        );
      }
      if (readResult.issue) {
        log.error(
          `[provider-health] automatic provider sync paused because the health store is ${readResult.issue.status}: ${readResult.issue.reason}`,
        );
      } else {
        await persistStateNow(currentState);
      }
      publishState(currentState);
    })();
  }
  await initPromise;
}

export function isProviderPaused(provider: HealthProviderId): boolean {
  return getProviderPause(provider) !== null;
}

export function getProviderPause(provider: HealthProviderId): ProviderPauseState | null {
  const storagePause = storageBlockPause(provider);
  if (storagePause) return storagePause;
  const pause = currentState?.providers[provider]?.pause ?? null;
  if (!pause || pause.pausedUntil <= Date.now()) return null;
  return pause;
}

export async function clearProviderPause(provider: HealthProviderId): Promise<void> {
  await initProviderHealth();
  const state = assertState();
  const nextState: PersistedHealthState = {
    ...state,
    providers: {
      ...state.providers,
      [provider]: {
        ...state.providers[provider],
        pause: null,
      },
    },
    updatedAt: Date.now(),
  };

  if (storageBlocksAutomaticProviderWork()) {
    try {
      await replaceUnsafeHealthStorage(nextState);
    } catch (error) {
      publishState(state);
      throw error;
    }
  } else if (!await persistStateNow(nextState)) {
    publishState(state);
    throw new Error("Provider health storage could not be updated.");
  }

  currentState = nextState;
  if (SOCIAL_PROVIDERS.has(provider)) {
    syncPauseToAuth(provider, null);
  }
  publishState(nextState);
}

export async function resetProviderPauseState(provider: HealthProviderId): Promise<void> {
  await initProviderHealth();
  const state = assertState();
  state.providers[provider] = {
    ...state.providers[provider],
    pause: null,
    lastPauseLevel: undefined,
    lastPauseDetectedAt: undefined,
  };
  if (SOCIAL_PROVIDERS.has(provider)) {
    syncPauseToAuth(provider, null);
  }
  state.updatedAt = Date.now();
  currentState = state;
  publishState(state);
  await persistStateNow(state);
}

export async function forgetRssFeedHealth(feedUrl: string): Promise<void> {
  await initProviderHealth();
  const state = assertState();
  if (!state.rssFeeds[feedUrl]) return;
  delete state.rssFeeds[feedUrl];
  state.updatedAt = Date.now();
  currentState = state;
  publishState(state, feedUrl);
  await persistStateNow(state);
}

export async function recordProviderHealthEvent(
  input: ProviderHealthEventInput,
): Promise<ProviderHealthAttempt> {
  await initProviderHealth();
  const attempt = normalizeAttempt(input);
  const state = assertState();
  const providerState = clearExpiredPause(state.providers[attempt.provider], attempt.finishedAt);
  state.providers[attempt.provider] = {
    ...providerState,
    dailyBuckets: bumpDailyBuckets(
      providerState.dailyBuckets,
      attempt.finishedAt,
      attempt.outcome,
      attempt.itemsSeen,
      attempt.itemsAdded,
      attempt.bytesMoved,
    ),
    hourlyBuckets: bumpHourlyBuckets(
      providerState.hourlyBuckets,
      attempt.finishedAt,
      attempt.outcome,
      attempt.itemsSeen,
      attempt.itemsAdded,
      attempt.bytesMoved,
    ),
    latestAttempts: upsertAttempt(
      providerState.latestAttempts,
      attempt,
      MAX_PROVIDER_ATTEMPTS,
    ),
  };

  if (attempt.scope === "rss_feed" && attempt.feedUrl) {
    const feedState = state.rssFeeds[attempt.feedUrl] ?? {
      feedUrl: attempt.feedUrl,
      feedTitle: attempt.feedTitle ?? attempt.feedUrl,
      dailyBuckets: [],
      hourlyBuckets: [],
      latestAttempts: [],
    };
    state.rssFeeds[attempt.feedUrl] = {
      ...feedState,
      feedTitle: attempt.feedTitle ?? feedState.feedTitle,
      dailyBuckets: [],
      hourlyBuckets: [],
      latestAttempts: upsertAttempt(
        feedState.latestAttempts,
        attempt,
        MAX_FEED_ATTEMPTS,
      ),
    };
  }

  maybeAutoPause(state, attempt);
  state.updatedAt = attempt.finishedAt;
  currentState = state;
  publishState(state, attempt.scope === "rss_feed" ? attempt.feedUrl : undefined);
  if (attempt.scope === "rss_feed") {
    schedulePersistState(state);
  } else {
    await persistStateNow(state);
  }
  return attempt;
}
