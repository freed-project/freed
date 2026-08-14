import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import { canStartBackgroundJob } from "./background-runtime-coordinator";
import { refreshSocialProvider } from "./capture";
import {
  claimMetaSyncScheduleAttempt,
  ensureMetaSyncSchedules,
  settleMetaSyncScheduleAttempt,
  type ScheduledMetaProvider,
} from "./meta-sync-schedule-state";
import {
  recordMetaSyncScheduleAttempt,
  recordMetaSyncScheduleOutcome,
} from "./runtime-health-events";

const META_PROVIDERS: readonly ScheduledMetaProvider[] = [
  "facebook",
  "instagram",
];
const DEFAULT_PROVIDER_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_SCHEDULER_TICK_MS = 60 * 1000;
const DEFAULT_STARTUP_DELAY_MS = 5 * 60 * 1000;
const META_IN_FLIGHT_LEASE_MS = 12 * 60 * 1000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 12 * 60 * 1000;

type MetaSyncSchedulerOptions = {
  providerIntervalMs?: number;
  schedulerTickMs?: number;
  startupDelayMs?: number;
};

let acceptingWork = false;
let tickIntervalId: ReturnType<typeof setInterval> | null = null;
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let tickInFlight: Promise<void> | null = null;
let nextProviderIndex = 0;
let storageBlockReported = false;
let currentProviderIntervalMs = DEFAULT_PROVIDER_INTERVAL_MS;
const activeOperations = new Set<Promise<unknown>>();

function attemptId(provider: ScheduledMetaProvider): string {
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toLocaleString("en-US", { useGrouping: false })}-${Math.random().toString(36).slice(2)}`;
  return `${provider}:${unique}`;
}

function reportStorageBlock(): void {
  if (storageBlockReported) return;
  storageBlockReported = true;
  addDebugEvent(
    "error",
    "[Sync] Facebook and Instagram scheduling paused because the device retry ledger is unavailable.",
  );
}

function providerOrder(): readonly ScheduledMetaProvider[] {
  const order =
    nextProviderIndex === 0
      ? META_PROVIDERS
      : ([META_PROVIDERS[1], META_PROVIDERS[0]] as const);
  nextProviderIndex = (nextProviderIndex + 1) % META_PROVIDERS.length;
  return order;
}

async function runDueProvider(
  provider: ScheduledMetaProvider,
  providerIntervalMs: number,
): Promise<void> {
  if (!acceptingWork) return;
  // Retain the due state while another local job owns the coordinator or the
  // renderer is ineligible. The next local tick retries without contacting
  // Meta or consuming the provider interval.
  if (!canStartBackgroundJob("social-scrape").ok) return;
  const startedAt = Date.now();
  const id = attemptId(provider);
  const claim = claimMetaSyncScheduleAttempt({
    provider,
    attemptId: id,
    now: startedAt,
    intervalMs: providerIntervalMs,
    inFlightLeaseMs: META_IN_FLIGHT_LEASE_MS,
  });
  if (claim.status === "storage_blocked") {
    reportStorageBlock();
    return;
  }
  if (claim.status !== "claimed") return;

  recordMetaSyncScheduleAttempt({
    provider,
    attemptId: id,
    overdueMs: claim.overdueMs,
    coalescedIntervals: claim.coalescedIntervals,
  });

  let outcome: Awaited<ReturnType<typeof refreshSocialProvider>>;
  try {
    outcome = await refreshSocialProvider(provider, "scheduled");
  } catch (error) {
    outcome = {
      provider,
      status: "error",
      stage: "exception",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const finishedAt = Date.now();
  settleMetaSyncScheduleAttempt({
    provider,
    attemptId: id,
    finishedAt,
    outcome: outcome.status,
    stage: outcome.stage,
  });
  recordMetaSyncScheduleOutcome({
    provider,
    attemptId: id,
    status: outcome.status,
    stage: outcome.stage ?? null,
    overdueMs: claim.overdueMs,
    coalescedIntervals: claim.coalescedIntervals,
    durationMs: Math.max(0, finishedAt - startedAt),
  });
}

async function runSchedulerTick(providerIntervalMs: number): Promise<void> {
  for (const provider of providerOrder()) {
    if (!acceptingWork) return;
    await runDueProvider(provider, providerIntervalMs);
  }
}

function triggerSchedulerTick(providerIntervalMs: number): void {
  if (!acceptingWork || tickInFlight) return;
  let tracked: Promise<void>;
  tracked = runSchedulerTick(providerIntervalMs).finally(() => {
    tickInFlight = null;
    activeOperations.delete(tracked);
  });
  tickInFlight = tracked;
  activeOperations.add(tracked);
}

function clearTimers(): void {
  if (startupTimeoutId !== null) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (tickIntervalId !== null) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

function wakeTick(): void {
  if (document.visibilityState === "visible") {
    triggerSchedulerTick(currentProviderIntervalMs);
  }
}

export function startMetaSyncScheduler(
  options: MetaSyncSchedulerOptions = {},
): void {
  if (acceptingWork) return;
  const providerIntervalMs =
    options.providerIntervalMs ?? DEFAULT_PROVIDER_INTERVAL_MS;
  const schedulerTickMs = options.schedulerTickMs ?? DEFAULT_SCHEDULER_TICK_MS;
  const startupDelayMs = options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS;
  acceptingWork = true;
  currentProviderIntervalMs = providerIntervalMs;
  storageBlockReported = false;
  const now = Date.now();
  if (!ensureMetaSyncSchedules(now + startupDelayMs)) {
    reportStorageBlock();
  }

  startupTimeoutId = setTimeout(() => {
    startupTimeoutId = null;
    triggerSchedulerTick(providerIntervalMs);
  }, startupDelayMs);
  tickIntervalId = setInterval(
    () => triggerSchedulerTick(providerIntervalMs),
    schedulerTickMs,
  );
  document.addEventListener("visibilitychange", wakeTick);
  window.addEventListener("focus", wakeTick);
  window.addEventListener("online", wakeTick);
}

export function stopMetaSyncScheduler(): void {
  acceptingWork = false;
  clearTimers();
  document.removeEventListener("visibilitychange", wakeTick);
  window.removeEventListener("focus", wakeTick);
  window.removeEventListener("online", wakeTick);
}

export async function stopMetaSyncSchedulerAndDrain(): Promise<void> {
  stopMetaSyncScheduler();
  await waitForFactoryResetDrain(
    () => Array.from(activeOperations),
    "Meta sync scheduler",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}

export function resetMetaSyncSchedulerForTests(): void {
  stopMetaSyncScheduler();
  tickInFlight = null;
  nextProviderIndex = 0;
  storageBlockReported = false;
  currentProviderIntervalMs = DEFAULT_PROVIDER_INTERVAL_MS;
  activeOperations.clear();
}
