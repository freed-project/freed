import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import {
  canStartBackgroundJob,
  isBackgroundRuntimeDeferredError,
} from "./background-runtime-coordinator";
import { runScheduledProviderAdapter } from "./provider-sync-adapters";
import {
  createCryptoRandomSource,
  type AutomaticSyncProvider,
  type RandomSource,
} from "./provider-sync-cadence";
import {
  claimProviderSchedule,
  deferProviderScheduleLocally,
  getProviderScheduleSnapshot,
  initializeProviderSchedules,
  listDueProviderSchedules,
  markProviderContactIssued,
  settleProviderSchedule,
  type ProviderScheduleRecord,
} from "./provider-sync-schedule-state";
import { recordProviderScheduleEvent } from "./runtime-health-events";

const DEFAULT_TICK_MS = 60 * 1_000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 15 * 60 * 1_000;

export interface ProviderSyncSchedulerOptions {
  tickMs?: number;
  random?: RandomSource;
  now?: () => number;
  existingInstall?: boolean;
}

let acceptingWork = false;
let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight: Promise<void> | null = null;
let wakePending = false;
let activeRandom: RandomSource | null = null;
let nowSource: () => number = Date.now;
const activeOperations = new Set<Promise<unknown>>();
const reportedStorageBlocks = new Set<AutomaticSyncProvider>();

function multiplierBucket(multiplier: number): string {
  if (multiplier < 0.75) return "faster";
  if (multiplier > 1.35) return "slower";
  return "baseline";
}

function eventBase(
  record: ProviderScheduleRecord,
  input: {
    attemptId?: string | null;
    scheduledAt?: number | null;
    actualAt: number;
    dueAgeMs?: number | null;
    wakeContext?: boolean;
    trigger?: "scheduled" | "migration" | "wake";
  },
) {
  return {
    provider: record.provider,
    attemptId: input.attemptId ?? null,
    trigger: input.trigger ?? "scheduled",
    scheduledAt: input.scheduledAt ?? record.nextDueAt,
    actualAt: input.actualAt,
    dueAgeMs: input.dueAgeMs ?? null,
    lowerBoundMs: record.bounds.lowerMs,
    upperBoundMs: record.bounds.upperMs,
    multiplierBucket: multiplierBucket(record.regime.multiplier),
    wakeContext: input.wakeContext ?? false,
    migrationContext: record.migrationContext,
  } as const;
}

function reportStorageBlock(provider: AutomaticSyncProvider): void {
  if (reportedStorageBlocks.has(provider)) return;
  reportedStorageBlocks.add(provider);
  addDebugEvent(
    "error",
    `[Sync] ${provider} automatic sync paused because its device schedule record is unavailable or unsupported.`,
  );
}

function initialize(now: number, random: RandomSource, existingInstall: boolean): void {
  const result = initializeProviderSchedules({ now, random, existingInstall });
  for (const provider of result.initialized) {
    const snapshot = getProviderScheduleSnapshot(provider);
    if (snapshot.status !== "supported" || !snapshot.record) continue;
    recordProviderScheduleEvent(
      "provider_schedule_initialized",
      eventBase(snapshot.record, {
        actualAt: now,
        trigger: "migration",
      }),
    );
  }
  for (const provider of result.blocked) {
    reportStorageBlock(provider);
    const snapshot = getProviderScheduleSnapshot(provider);
    if (snapshot.status === "supported" && snapshot.record) {
      recordProviderScheduleEvent(
        "provider_schedule_state_blocked",
        eventBase(snapshot.record, { actualAt: now }),
      );
    }
  }
}

function chooseDueProvider(now: number, random: RandomSource) {
  const ranked = listDueProviderSchedules(now)
    .map((candidate) => ({ candidate, tie: random.uniform() }))
    .sort(
      (left, right) =>
        right.candidate.normalizedOverdue - left.candidate.normalizedOverdue ||
        left.tie - right.tie,
    );
  return {
    selected: ranked[0]?.candidate,
    deferred: ranked.slice(1).map(({ candidate }) => candidate),
  };
}

async function runOne(wakeContext: boolean): Promise<void> {
  if (!acceptingWork || !activeRandom) return;
  const random = activeRandom;
  const decisionAt = nowSource();
  const decision = chooseDueProvider(decisionAt, random);
  const due = decision.selected;
  if (!due) return;
  for (const deferred of decision.deferred) {
    const snapshot = getProviderScheduleSnapshot(deferred.provider);
    if (snapshot.status !== "supported" || !snapshot.record) {
      reportStorageBlock(deferred.provider);
      continue;
    }
    deferProviderScheduleLocally({
      provider: deferred.provider,
      category: "provider_collision",
      now: decisionAt,
      random,
    });
    recordProviderScheduleEvent("provider_schedule_deferred", {
      ...eventBase(snapshot.record, {
        actualAt: decisionAt,
        dueAgeMs: deferred.dueAgeMs,
        wakeContext,
        trigger: wakeContext ? "wake" : "scheduled",
      }),
      deferralCategory: "provider_collision",
    });
  }
  const before = getProviderScheduleSnapshot(due.provider);
  if (before.status !== "supported" || !before.record) {
    reportStorageBlock(due.provider);
    return;
  }
  recordProviderScheduleEvent(
    "provider_schedule_decision",
    eventBase(before.record, {
      actualAt: decisionAt,
      dueAgeMs: due.dueAgeMs,
      wakeContext,
      trigger: wakeContext ? "wake" : "scheduled",
    }),
  );

  const gate = canStartBackgroundJob("social-scrape");
  if (!gate.ok) {
    deferProviderScheduleLocally({
      provider: due.provider,
      category: gate.reason,
      now: decisionAt,
      random,
    });
    recordProviderScheduleEvent(
      "provider_schedule_deferred",
      {
        ...eventBase(before.record, {
          actualAt: decisionAt,
          dueAgeMs: due.dueAgeMs,
          wakeContext,
          trigger: wakeContext ? "wake" : "scheduled",
        }),
        deferralCategory: gate.reason,
      },
    );
    return;
  }

  const claim = claimProviderSchedule({
    provider: due.provider,
    now: decisionAt,
    random,
  });
  if (claim.status !== "claimed") {
    if (claim.status === "storage_blocked") reportStorageBlock(due.provider);
    return;
  }
  recordProviderScheduleEvent(
    "provider_schedule_claimed",
    eventBase(claim.record, {
      attemptId: claim.attempt.attemptId,
      scheduledAt: claim.attempt.scheduledAt,
      actualAt: decisionAt,
      dueAgeMs: claim.dueAgeMs,
      wakeContext,
    }),
  );

  let contactCount = 0;
  const onProviderContact = () => {
    const contactAt = nowSource();
    const contact = markProviderContactIssued({
      provider: due.provider,
      attemptId: claim.attempt.attemptId,
      now: contactAt,
    });
    contactCount = contact?.contactCount ?? contactCount;
    if (!contact) return;
    recordProviderScheduleEvent("provider_contact_issued", {
      ...eventBase(claim.record, {
        attemptId: claim.attempt.attemptId,
        scheduledAt: claim.attempt.scheduledAt,
        actualAt: contactAt,
        dueAgeMs: claim.dueAgeMs,
        wakeContext,
      }),
      contactIndex: contact.contactCount,
    });
  };
  let result;
  try {
    result = await runScheduledProviderAdapter(due.provider, onProviderContact);
  } catch (error) {
    result = {
      provider: due.provider,
      status: isBackgroundRuntimeDeferredError(error) ? "deferred" : "error",
      stage: isBackgroundRuntimeDeferredError(error)
        ? error.reason
        : "exception",
      detail: error instanceof Error ? error.message : String(error),
    } as const;
  }
  const finishedAt = nowSource();
  const authBlocked = result.stage === "auth";
  settleProviderSchedule({
    provider: due.provider,
    attemptId: claim.attempt.attemptId,
    now: finishedAt,
    random,
    status: result.status,
    stage: result.stage,
    itemsSeen: result.postsExtracted,
    itemsAdded: result.itemsAdded,
    retryAfterMs: result.retryAfterMs,
    authBlocked,
  });
  const settled = getProviderScheduleSnapshot(due.provider);
  if (settled.status !== "supported" || !settled.record) return;
  if (settled.record.regime.startedAt !== claim.record.regime.startedAt) {
    recordProviderScheduleEvent(
      "provider_schedule_regime_changed",
      eventBase(settled.record, {
        attemptId: claim.attempt.attemptId,
        scheduledAt: claim.attempt.scheduledAt,
        actualAt: finishedAt,
        dueAgeMs: claim.dueAgeMs,
        wakeContext,
      }),
    );
  }
  const event =
    settled.record.phase === "backoff"
      ? "provider_schedule_backoff"
      : settled.record.phase === "blocked"
        ? "provider_schedule_state_blocked"
        : result.status === "deferred" && contactCount === 0
          ? "provider_schedule_deferred"
          : "provider_schedule_settled";
  recordProviderScheduleEvent(event, {
    ...eventBase(settled.record, {
      attemptId: claim.attempt.attemptId,
      scheduledAt: claim.attempt.scheduledAt,
      actualAt: finishedAt,
      dueAgeMs: claim.dueAgeMs,
      wakeContext,
    }),
    deferralCategory: event === "provider_schedule_deferred" ? (result.stage ?? null) : null,
    outcome: result.status,
    stage: result.stage ?? null,
    itemsSeen: result.postsExtracted ?? 0,
    itemsAdded: result.itemsAdded ?? 0,
    durationMs: Math.max(0, finishedAt - decisionAt),
  });
}

function triggerTick(wakeContext = false): void {
  if (!acceptingWork || tickInFlight) {
    wakePending ||= wakeContext;
    return;
  }
  let tracked: Promise<void>;
  tracked = runOne(wakeContext).finally(() => {
    tickInFlight = null;
    activeOperations.delete(tracked);
    if (wakePending && acceptingWork) {
      wakePending = false;
      triggerTick(true);
    }
  });
  tickInFlight = tracked;
  activeOperations.add(tracked);
}

function wake(): void {
  if (document.visibilityState === "visible") triggerTick(true);
}

export function startProviderSyncScheduler(
  options: ProviderSyncSchedulerOptions = {},
): void {
  if (acceptingWork) return;
  acceptingWork = true;
  activeRandom = options.random ?? createCryptoRandomSource();
  nowSource = options.now ?? Date.now;
  reportedStorageBlocks.clear();
  initialize(nowSource(), activeRandom, options.existingInstall ?? false);
  timer = setInterval(() => triggerTick(false), options.tickMs ?? DEFAULT_TICK_MS);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  triggerTick(false);
}

export function stopProviderSyncScheduler(): void {
  acceptingWork = false;
  wakePending = false;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", wake);
  window.removeEventListener("focus", wake);
  window.removeEventListener("online", wake);
}

export async function stopProviderSyncSchedulerAndDrain(): Promise<void> {
  stopProviderSyncScheduler();
  await waitForFactoryResetDrain(
    () => Array.from(activeOperations),
    "Provider sync scheduler",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}
