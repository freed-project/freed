import { isTauri } from "@tauri-apps/api/core";
import { Store, load } from "@tauri-apps/plugin-store";
import { toast } from "@freed/ui/components/Toast";
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

const HEALTH_STORE_FILE = "sync-health.json";
const HEALTH_STORE_KEY = "provider-health";
const FALLBACK_STORAGE_KEY = "freed.provider-health";
const MOCK_STORE_STORAGE_KEY = `__TAURI_MOCK_STORE__:${HEALTH_STORE_FILE}`;
const MAX_PROVIDER_ATTEMPTS = 20;
const MAX_FEED_ATTEMPTS = 20;
const PROVIDERS: HealthProviderId[] = [
  "rss",
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "gdrive",
  "dropbox",
];
const SOCIAL_PROVIDERS = new Set<HealthProviderId>([
  "x",
  "facebook",
  "instagram",
  "linkedin",
]);
const DEFAULT_DAILY_BUCKETS = 7;
const DEFAULT_HOURLY_BUCKETS = 24;
const PAUSE_HOURS = [2, 4, 6] as const;
const RATE_LIMIT_HEURISTIC_WINDOW_MS = 90 * 60 * 1000;
const FAILING_FEED_OUTAGE_MS = 24 * 60 * 60 * 1000;

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

let healthStore: Store | null = null;
let currentState: PersistedHealthState | null = null;
let initPromise: Promise<void> | null = null;

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
      gdrive: emptyProviderState("gdrive", now),
      dropbox: emptyProviderState("dropbox", now),
    },
    rssFeeds: {},
    updatedAt: now,
  };
}

function fallbackRead(): PersistedHealthState | null {
  try {
    const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (raw) {
      return coercePersistedHealthState(JSON.parse(raw));
    }
  } catch {
    // Ignore fallback storage failures.
  }

  try {
    const raw = window.localStorage.getItem(MOCK_STORE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return coercePersistedHealthState(parsed[HEALTH_STORE_KEY]);
  } catch {
    return null;
  }
}

function fallbackWrite(state: PersistedHealthState): void {
  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore fallback storage failures.
  }

  try {
    const raw = window.localStorage.getItem(MOCK_STORE_STORAGE_KEY);
    const parsed =
      raw && raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed[HEALTH_STORE_KEY] = state;
    window.localStorage.setItem(MOCK_STORE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore mock store persistence failures.
  }
}

async function getStore(): Promise<Store> {
  if (!isTauri()) {
    throw new Error("Native health store is unavailable outside Freed Desktop");
  }
  if (!healthStore) {
    healthStore = await load(HEALTH_STORE_FILE, { defaults: {}, autoSave: true });
  }
  return healthStore;
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

function coerceAttempt(value: unknown): ProviderHealthAttempt | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as Partial<ProviderHealthAttempt>;
  if (typeof attempt.provider !== "string" || typeof attempt.outcome !== "string") {
    return null;
  }
  return {
    id: typeof attempt.id === "string" ? attempt.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    provider: attempt.provider as HealthProviderId,
    scope: attempt.scope === "rss_feed" ? "rss_feed" : "provider",
    feedUrl: typeof attempt.feedUrl === "string" ? attempt.feedUrl : undefined,
    feedTitle: typeof attempt.feedTitle === "string" ? attempt.feedTitle : undefined,
    outcome: attempt.outcome as HealthOutcome,
    stage: typeof attempt.stage === "string" ? attempt.stage : undefined,
    reason: typeof attempt.reason === "string" ? attempt.reason : undefined,
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
  if (typeof pause.pausedUntil !== "number" || typeof pause.pauseReason !== "string") {
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
          ? latestAttempts
          : synthesizeProviderAttempts(provider, next),
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
      feedTitle: typeof next.feedTitle === "string" && next.feedTitle.length > 0 ? next.feedTitle : feedUrl,
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
      latestAttempts: (() => {
        const latestAttempts = coerceAttempts(next.latestAttempts, MAX_FEED_ATTEMPTS);
        return latestAttempts.length > 0
          ? latestAttempts
          : synthesizeFeedAttempts(feedUrl, next);
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
        feedTitle:
          typeof feedState.feedTitle === "string" && feedState.feedTitle.length > 0
            ? feedState.feedTitle
            : feedState.feedUrl,
        dailyBuckets: coerceBuckets(
          feedState.dailyBuckets,
          defaultDailyBuckets(now),
          "dateKey",
        ),
        hourlyBuckets: coerceBuckets(
          feedState.hourlyBuckets,
          defaultHourlyBuckets(now),
          "hourKey",
        ),
        latestAttempts: (() => {
          const latestAttempts = coerceAttempts(feedState.latestAttempts, MAX_FEED_ATTEMPTS);
          return latestAttempts.length > 0
            ? latestAttempts
            : synthesizeFeedAttempts(feedState.feedUrl, feedState);
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
  return [attempt, ...attempts].slice(0, max);
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
  }
}

function providerStatus(providerState: PersistedProviderHealth): ProviderHealthSnapshot["status"] {
  const currentPause = providerState.pause;
  if (currentPause && currentPause.pausedUntil > Date.now()) return "paused";
  const latest = providerState.latestAttempts[0];
  if (!latest) return "idle";
  if (bucketSuccess(latest.outcome)) return "healthy";
  return "degraded";
}

function messageFor(providerState: PersistedProviderHealth): string | undefined {
  const latest = providerState.latestAttempts[0];
  if (!latest) return undefined;
  if (providerState.pause && providerState.pause.pausedUntil > Date.now()) {
    return providerState.pause.pauseReason;
  }
  if (latest.outcome === "success") return undefined;
  if (latest.reason) return latest.reason;
  if (latest.outcome === "cooldown") return "Cooling down";
  if (latest.outcome === "provider_rate_limit") return "Rate limit detected";
  if (latest.outcome === "empty") return "No posts pulled";
  return "Needs attention";
}

function snapshotForProvider(providerState: PersistedProviderHealth): ProviderHealthSnapshot {
  const latestAttempt = providerState.latestAttempts[0];
  const latestWasSuccessful = !!latestAttempt && bucketSuccess(latestAttempt.outcome);
  return {
    provider: providerState.provider,
    status: providerStatus(providerState),
    lastAttemptAt: latestAttempt?.finishedAt,
    lastSuccessfulAt: lastSuccessfulAt(providerState.latestAttempts),
    lastOutcome: latestAttempt?.outcome,
    lastError: latestWasSuccessful ? undefined : latestAttempt?.reason,
    currentMessage: messageFor(providerState),
    pause: providerState.pause,
    dailyBuckets: providerState.dailyBuckets,
    hourlyBuckets: providerState.hourlyBuckets,
    latestAttempts: providerState.latestAttempts,
    totalSeen7d: providerState.dailyBuckets.reduce(
      (sum, bucket) => sum + bucket.itemsSeen,
      0,
    ),
    totalAdded7d: providerState.dailyBuckets.reduce(
      (sum, bucket) => sum + bucket.itemsAdded,
      0,
    ),
    totalBytes7d: providerState.dailyBuckets.reduce(
      (sum, bucket) => sum + bucket.bytesMoved,
      0,
    ),
  };
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
    dailyBuckets: feedState.dailyBuckets,
    hourlyBuckets: feedState.hourlyBuckets,
    latestAttempts: feedState.latestAttempts,
  };
}

function publishState(state: PersistedHealthState): void {
  const providers = Object.fromEntries(
    PROVIDERS.map((provider) => [provider, snapshotForProvider(state.providers[provider])]),
  ) as Record<HealthProviderId, ProviderHealthSnapshot>;
  const failingRssFeeds = Object.values(state.rssFeeds)
    .map(snapshotForFeed)
    .filter((feed) => feed.status === "failing")
    .sort((a, b) => {
      const aOutage = a.outageSince ?? 0;
      const bOutage = b.outageSince ?? 0;
      return aOutage - bOutage;
    });

  setProviderHealth({
    providers,
    failingRssFeeds,
    updatedAt: state.updatedAt,
  });
}

async function persistState(state: PersistedHealthState): Promise<void> {
  if (!isTauri()) {
    fallbackWrite(state);
    return;
  }
  try {
    const store = await getStore();
    await store.set(HEALTH_STORE_KEY, state);
  } catch (error) {
    log.error(
      `[provider-health] failed to persist health store, falling back: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    fallbackWrite(state);
  }
}

async function readState(): Promise<PersistedHealthState> {
  if (!isTauri()) {
    return fallbackRead() ?? createEmptyState();
  }
  try {
    const store = await getStore();
    const value = await store.get<unknown>(HEALTH_STORE_KEY);
    return coercePersistedHealthState(value);
  } catch (error) {
    log.error(
      `[provider-health] failed to read health store, falling back: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallbackRead() ?? createEmptyState();
  }
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
    scope: input.scope ?? "provider",
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

export async function initProviderHealth(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      currentState = await readState();
      for (const provider of PROVIDERS) {
        currentState.providers[provider] = clearExpiredPause(
          currentState.providers[provider],
        );
      }
      publishState(currentState);
      await persistState(currentState);
    })();
  }
  await initPromise;
}

export function isProviderPaused(provider: HealthProviderId): boolean {
  const state = currentState?.providers[provider];
  return !!state?.pause && state.pause.pausedUntil > Date.now();
}

export function getProviderPause(provider: HealthProviderId): ProviderPauseState | null {
  const pause = currentState?.providers[provider]?.pause ?? null;
  if (!pause || pause.pausedUntil <= Date.now()) return null;
  return pause;
}

export async function clearProviderPause(provider: HealthProviderId): Promise<void> {
  await initProviderHealth();
  const state = assertState();
  state.providers[provider] = {
    ...state.providers[provider],
    pause: null,
  };
  if (SOCIAL_PROVIDERS.has(provider)) {
    syncPauseToAuth(provider, null);
  }
  state.updatedAt = Date.now();
  currentState = state;
  publishState(state);
  await persistState(state);
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
  await persistState(state);
}

export async function forgetRssFeedHealth(feedUrl: string): Promise<void> {
  await initProviderHealth();
  const state = assertState();
  if (!state.rssFeeds[feedUrl]) return;
  delete state.rssFeeds[feedUrl];
  state.updatedAt = Date.now();
  currentState = state;
  publishState(state);
  await persistState(state);
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
      dailyBuckets: defaultDailyBuckets(attempt.finishedAt),
      hourlyBuckets: defaultHourlyBuckets(attempt.finishedAt),
      latestAttempts: [],
    };
    state.rssFeeds[attempt.feedUrl] = {
      ...feedState,
      feedTitle: attempt.feedTitle ?? feedState.feedTitle,
      dailyBuckets: bumpDailyBuckets(
        feedState.dailyBuckets,
        attempt.finishedAt,
        attempt.outcome,
        attempt.itemsSeen,
        attempt.itemsAdded,
        attempt.bytesMoved,
      ),
      hourlyBuckets: bumpHourlyBuckets(
        feedState.hourlyBuckets,
        attempt.finishedAt,
        attempt.outcome,
        attempt.itemsSeen,
        attempt.itemsAdded,
        attempt.bytesMoved,
      ),
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
  publishState(state);
  await persistState(state);
  return attempt;
}
