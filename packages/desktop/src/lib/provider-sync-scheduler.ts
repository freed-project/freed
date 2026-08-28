import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import {
  canStartBackgroundJob,
  getNativeBackgroundRuntimeOperationStatus,
  isBackgroundRuntimeDeferredError,
} from "./background-runtime-coordinator";
import { runScheduledProviderAdapter } from "./provider-sync-adapters";
import {
  AUTOMATIC_SYNC_PROVIDERS,
  createCryptoRandomSource,
  type AutomaticSyncProvider,
  type RandomSource,
} from "./provider-sync-cadence";
import {
  claimProviderSchedule,
  deferProviderScheduleLocally,
  getAutomaticProviderSyncEnabled,
  getProviderScheduleSnapshot,
  initializeProviderSchedules,
  listDueProviderSchedules,
  markProviderContactIssued,
  reconcileProviderScheduleOwnership,
  settleProviderSchedule,
  type ProviderScheduleRecord,
} from "./provider-sync-schedule-state";
import { recordProviderScheduleEvent } from "./runtime-health-events";
import {
  getProviderSyncRuntimeEligibility,
  replaceNativeProviderScheduleWake,
} from "./provider-sync-native-wake";

const DEFAULT_TICK_MS = 60 * 1_000;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 15 * 60 * 1_000;
const SCHEDULE_CHANGE_EVENT = "freed-provider-sync-schedule-change";

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
let nativeMirrorInFlight: Promise<void> | null = null;
let nativeMirrorPending = false;
let nativeMirrorFailureReported = false;
const activeOperations = new Set<Promise<unknown>>();
const reportedStorageBlocks = new Set<AutomaticSyncProvider>();

function nextNativeWake(): {
  provider: AutomaticSyncProvider;
  deadlineAtMs: number;
} | null {
  if (!getAutomaticProviderSyncEnabled()) return null;
  const candidates: Array<{
    provider: AutomaticSyncProvider;
    deadlineAtMs: number;
  }> = [];
  for (const provider of AUTOMATIC_SYNC_PROVIDERS) {
    const snapshot = getProviderScheduleSnapshot(provider);
    if (snapshot.status !== "supported" || !snapshot.record) continue;
    const record = snapshot.record;
    if (record.automaticPaused || record.phase === "blocked") continue;
    candidates.push({
      provider,
      deadlineAtMs: record.attempt
        ? record.attempt.leaseUntil
        : Math.max(
            record.nextDueAt,
            record.activationAt,
            record.localEligibilityRetryAt ?? 0,
          ),
    });
  }
  return candidates.sort(
    (left, right) =>
      left.deadlineAtMs - right.deadlineAtMs ||
      left.provider.localeCompare(right.provider),
  )[0] ?? null;
}

function requestNativeWakeMirror(): void {
  if (!acceptingWork) return;
  if (nativeMirrorInFlight) {
    nativeMirrorPending = true;
    return;
  }
  const wake = nextNativeWake();
  nativeMirrorInFlight = replaceNativeProviderScheduleWake(wake)
    .catch((error) => {
      if (nativeMirrorFailureReported) return;
      nativeMirrorFailureReported = true;
      addDebugEvent(
        "error",
        `[Sync] Native provider deadline scheduling is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    })
    .finally(() => {
      nativeMirrorInFlight = null;
      if (nativeMirrorPending && acceptingWork) {
        nativeMirrorPending = false;
        requestNativeWakeMirror();
      }
    });
}

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

function providerForNativeOperation(
  operation: string | null,
): AutomaticSyncProvider | null {
  if (!operation) return null;
  if (operation.startsWith("fb_")) return "facebook";
  if (operation.startsWith("ig_")) return "instagram";
  if (operation.startsWith("li_")) return "linkedin";
  if (operation.startsWith("yt_")) return "youtube";
  if (operation.startsWith("substack_")) return "substack";
  if (operation.startsWith("medium_")) return "medium";
  return null;
}

async function runOne(wakeContext: boolean): Promise<void> {
  if (!acceptingWork || !activeRandom) return;
  const random = activeRandom;
  const decisionAt = nowSource();
  const runtimeEligibility = await getProviderSyncRuntimeEligibility();
  if (!runtimeEligibility.eligible) return;
  const nativeOperation = await getNativeBackgroundRuntimeOperationStatus();
  const ownership = reconcileProviderScheduleOwnership({
    now: decisionAt,
    random,
    nativeStatusAvailable: nativeOperation.available,
    nativeOperationActive: nativeOperation.operation !== null,
    nativeActiveProvider: providerForNativeOperation(nativeOperation.operation),
  });
  for (const provider of ownership.abandonedProviders) {
    const snapshot = getProviderScheduleSnapshot(provider);
    if (snapshot.status !== "supported" || !snapshot.record) continue;
    recordProviderScheduleEvent(
      "provider_schedule_settled",
      {
        ...eventBase(snapshot.record, {
          actualAt: decisionAt,
          wakeContext,
          trigger: wakeContext ? "wake" : "scheduled",
        }),
        outcome: "abandoned",
        stage: "stale_lease",
      },
    );
  }
  if (nativeOperation.operation !== null || ownership.busyProvider) return;
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
    requestNativeWakeMirror();
    if (wakePending && acceptingWork) {
      wakePending = false;
      triggerTick(true);
    }
  });
  tickInFlight = tracked;
  activeOperations.add(tracked);
}

export function wakeProviderSyncScheduler(): void {
  if (document.visibilityState === "visible") triggerTick(true);
}

export function wakeProviderSyncSchedulerFromNative(): void {
  triggerTick(true);
}

function refreshProviderSyncSchedule(): void {
  requestNativeWakeMirror();
  if (document.visibilityState === "visible") triggerTick(false);
}

export function startProviderSyncScheduler(
  options: ProviderSyncSchedulerOptions = {},
): void {
  if (acceptingWork) return;
  acceptingWork = true;
  activeRandom = options.random ?? createCryptoRandomSource();
  nowSource = options.now ?? Date.now;
  reportedStorageBlocks.clear();
  nativeMirrorFailureReported = false;
  initialize(nowSource(), activeRandom, options.existingInstall ?? false);
  requestNativeWakeMirror();
  timer = setInterval(() => triggerTick(false), options.tickMs ?? DEFAULT_TICK_MS);
  document.addEventListener("visibilitychange", wakeProviderSyncScheduler);
  window.addEventListener("focus", wakeProviderSyncScheduler);
  window.addEventListener("online", wakeProviderSyncScheduler);
  window.addEventListener(SCHEDULE_CHANGE_EVENT, refreshProviderSyncSchedule);
  triggerTick(false);
}

export function stopProviderSyncScheduler(): void {
  acceptingWork = false;
  wakePending = false;
  nativeMirrorPending = false;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", wakeProviderSyncScheduler);
  window.removeEventListener("focus", wakeProviderSyncScheduler);
  window.removeEventListener("online", wakeProviderSyncScheduler);
  window.removeEventListener(SCHEDULE_CHANGE_EVENT, refreshProviderSyncSchedule);
  void replaceNativeProviderScheduleWake(null).catch(() => {});
}

export async function stopProviderSyncSchedulerAndDrain(): Promise<void> {
  stopProviderSyncScheduler();
  await waitForFactoryResetDrain(
    () => Array.from(activeOperations),
    "Provider sync scheduler",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}
