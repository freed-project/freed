/**
 * Outbox Processor
 *
 * Subscribes to the Automerge doc, detects pending social engagement actions
 * (liked && !likedSyncedAt, readAt && !seenSyncedAt), and drains them via the
 * platform actions registry.
 *
 * Architecture:
 *   - Runs on the desktop only (has WebView sessions + X cookies).
 *   - Debounces 5s to batch rapid changes (e.g. user double-clicking like).
 *   - Processes items sequentially to avoid hammering APIs.
 *   - Reserves each provider attempt in a device-local persistent ledger.
 *   - Stops after three attempts for the exact local intent.
 *   - Synchronizes positive confirmations only. Historical -1 sentinels stay terminal.
 *   - Returns a teardown function; call it to stop the processor.
 *
 * Limitations:
 *   - Unlike is NOT synced to platforms. When a user un-likes, the schema
 *     clears likedSyncedAt, but the outbox only detects liked=true items.
 *     The unlike stays local. Acceptable for v1 since unlike is rare and
 *     the user can unlike directly on the platform.
 */

import type { FeedItem, Platform } from "@freed/shared";
import type { PlatformActions } from "./platform-actions";
import type { DocChangeEvent } from "./automerge-types";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { waitForFactoryResetDrain } from "@freed/ui/lib/factory-reset";
import { scheduleSideEffect } from "./side-effect-scheduler";
import {
  formatBackgroundRuntimeDeferredReason,
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator";
import { recordSocialOutboxAttempt } from "./runtime-health-events";
import {
  beginSocialOutboxAttempt,
  completeSocialOutboxIntent,
  getExplicitSocialOutboxIntent,
  markSocialOutboxPlatformConfirmed,
  pruneSocialOutboxState,
  recordExplicitSocialOutboxIntent,
  type SocialOutboxAction,
  type SocialOutboxIntent,
} from "./social-outbox-state";

// =============================================================================
// Constants
// =============================================================================

const DEBOUNCE_MS = 5_000;
const SCAN_YIELD_EVERY = 500;
const FACTORY_RESET_DRAIN_TIMEOUT_MS = 120_000;

interface ActiveOutboxRuntime {
  stop(): void;
}

let activeOutboxRuntime: ActiveOutboxRuntime | null = null;
let activeDrain: Promise<void> | null = null;
let factoryResetDrainInProgress = false;
const activeResetSensitiveOperations = new Set<Promise<unknown>>();

function trackResetSensitiveOperation<T>(operation: Promise<T>): Promise<T> {
  let tracked: Promise<T>;
  tracked = operation.finally(() => activeResetSensitiveOperations.delete(tracked));
  activeResetSensitiveOperations.add(tracked);
  return tracked;
}

async function runOutboxDrainExclusive(run: () => Promise<void>): Promise<void> {
  while (activeDrain) {
    try {
      await activeDrain;
    } catch {
      // The waiting processor still needs its turn after a prior drain fails.
    }
  }

  const currentDrain = Promise.resolve().then(run);
  activeDrain = currentDrain;
  try {
    await currentDrain;
  } finally {
    if (activeDrain === currentDrain) activeDrain = null;
  }
}

// =============================================================================
// Types
// =============================================================================

/** Called by outbox after a platform confirms the like action. */
export type ConfirmFn = (id: string, syncedAt?: number) => Promise<void>;

// =============================================================================
// Outbox Processor
// =============================================================================

/**
 * Start the outbox processor.
 *
 * @param getItems         Returns the current item list (from worker DocState)
 * @param subscribe        Subscribe to doc changes; returns unsubscribe fn
 * @param platformActions  Platform -> PlatformActions registry
 * @param confirmLiked     Called on successful like sync
 * @param confirmSeen      Called on successful seen sync
 * @returns Teardown function - call to stop the processor
 */
export function startOutboxProcessor(
  getItems: () => FeedItem[] | null,
  subscribe: (cb: (event: DocChangeEvent) => void) => () => void,
  platformActions: Map<Platform, PlatformActions>,
  confirmLiked: ConfirmFn,
  confirmSeen: ConfirmFn,
): () => void {
  if (factoryResetDrainInProgress) return () => {};
  activeOutboxRuntime?.stop();

  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let isDraining = false;
  let drainRequested = false;
  let fullScanRequested = true;
  let stopped = false;
  let unsubscribe: () => void = () => {};
  const pendingChangedItems = new Map<string, FeedItem>();

  function addDrainEvent(event?: DocChangeEvent) {
    if (!event) {
      return;
    }

    if (event.requiresFullScan) {
      fullScanRequested = true;
      return;
    }

    for (const item of event.changedItems) {
      if (
        event.mutation === "TOGGLE_LIKED"
        && item.userState.liked
        && item.userState.likedSyncedAt === undefined
      ) {
        const intent = makeIntent(item, "like", item.userState.likedAt);
        if (intent) recordExplicitSocialOutboxIntent(intent);
      }
      pendingChangedItems.set(item.globalId, item);
    }
  }

  function requeueItem(item: FeedItem) {
    if (stopped) return;
    pendingChangedItems.set(item.globalId, item);
  }

  function makeIntent(
    item: FeedItem,
    action: SocialOutboxAction,
    intentAt: number | undefined,
  ): SocialOutboxIntent | null {
    if (typeof intentAt !== "number" || !Number.isFinite(intentAt) || intentAt < 0) {
      return null;
    }
    return {
      globalId: item.globalId,
      platform: item.platform,
      action,
      intentAt,
    };
  }

  interface PendingAction {
    item: FeedItem;
    intent: SocialOutboxIntent;
  }

  async function collectPendingQueues(items: FeedItem[], shouldPrune: boolean) {
    const likeQueue: PendingAction[] = [];
    const seenQueue: PendingAction[] = [];
    const activeIntents: SocialOutboxIntent[] = [];

    for (let index = 0; index < items.length; index += 1) {
      if (index > 0 && index % SCAN_YIELD_EVERY === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const item = items[index];
      const us = item.userState;

      const explicitLikeIntent = getExplicitSocialOutboxIntent(item.globalId, "like");
      const canRunLike = us.liked && (
        us.likedSyncedAt === undefined
        || (us.likedSyncedAt === -1 && explicitLikeIntent?.platform === item.platform)
      );
      if (canRunLike) {
        const intent = explicitLikeIntent?.platform === item.platform
          ? explicitLikeIntent
          : makeIntent(item, "like", us.likedAt);
        if (intent) {
          likeQueue.push({ item, intent });
          activeIntents.push(intent);
        }
      }

      if (us.seenSyncedAt === undefined && item.sourceUrl) {
        const intent = makeIntent(item, "seen", us.readAt);
        if (intent) {
          seenQueue.push({ item, intent });
          activeIntents.push(intent);
        }
      }
    }

    if (shouldPrune) pruneSocialOutboxState(activeIntents);
    return { likeQueue, seenQueue };
  }

  async function confirmPositive(
    pending: PendingAction,
    confirmedAt: number,
    confirm: ConfirmFn,
  ): Promise<boolean> {
    try {
      await confirm(pending.item.globalId, confirmedAt);
      completeSocialOutboxIntent(pending.intent);
      return true;
    } catch (error) {
      addDebugEvent(
        "error",
        `[Outbox] ${pending.intent.action} acknowledgement failed on ${pending.item.platform}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      requeueItem(pending.item);
      return false;
    }
  }

  async function processPendingAction(
    pending: PendingAction,
    action: (item: FeedItem) => Promise<boolean>,
    confirm: ConfirmFn,
  ): Promise<void> {
    const decision = beginSocialOutboxAttempt(pending.intent);
    if (decision.kind === "capacity") {
      addDebugEvent(
        "error",
        `[Outbox] local retry ledger is full; skipping ${pending.intent.action} on ${pending.item.platform}`,
      );
      return;
    }
    if (decision.kind === "exhausted") return;
    if (decision.kind === "confirmed") {
      await confirmPositive(pending, decision.confirmedAt, confirm);
      return;
    }

    recordSocialOutboxAttempt({
      provider: pending.item.platform,
      action: pending.intent.action,
      attempt: decision.attempt,
      maxAttempts: decision.maxAttempts,
    });

    try {
      const ok = await action(pending.item);
      if (ok) {
        const confirmedAt = Date.now();
        const confirmationPersisted = markSocialOutboxPlatformConfirmed(
          pending.intent,
          confirmedAt,
        );
        if (!confirmationPersisted) {
          addDebugEvent(
            "error",
            `[Outbox] ${pending.intent.action} provider confirmation could not be stored on this device; keeping a runtime terminal marker on ${pending.item.platform}`,
          );
        }
        await confirmPositive(pending, confirmedAt, confirm);
        return;
      }

      addDebugEvent(
        "change",
        `[Outbox] ${pending.intent.action} soft failure ${decision.attempt.toLocaleString()} of ${
          decision.maxAttempts.toLocaleString()
        } on ${pending.item.platform}`,
      );
    } catch (error) {
      addDebugEvent(
        "error",
        `[Outbox] ${pending.intent.action} attempt ${decision.attempt.toLocaleString()} threw on ${
          pending.item.platform
        }: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!decision.exhaustedAfterAttempt) requeueItem(pending.item);
  }

  async function drainNow() {
    if (stopped || isDraining) return;
    isDraining = true;
    drainRequested = false;

    let items: FeedItem[];
    let shouldPrune = false;
    if (fullScanRequested) {
      const currentItems = getItems();
      if (!currentItems) {
        isDraining = false;
        return;
      }
      fullScanRequested = false;
      pendingChangedItems.clear();
      items = currentItems;
      shouldPrune = true;
    } else {
      items = Array.from(pendingChangedItems.values());
      pendingChangedItems.clear();
    }

    if (items.length === 0) {
      isDraining = false;
      return;
    }

    const { likeQueue, seenQueue } = await collectPendingQueues(items, shouldPrune);

    if (likeQueue.length > 0) {
      addDebugEvent("change", `[Outbox] draining ${likeQueue.length.toLocaleString()} pending like(s)`);
    }
    if (seenQueue.length > 0) {
      addDebugEvent("change", `[Outbox] draining ${seenQueue.length.toLocaleString()} pending seen(s)`);
    }

    for (const pending of likeQueue) {
      const actions = platformActions.get(pending.item.platform);
      if (!actions) continue;
      await processPendingAction(pending, actions.like.bind(actions), confirmLiked);
    }

    for (const pending of seenQueue) {
      const actions = platformActions.get(pending.item.platform);
      if (!actions) continue;
      await processPendingAction(pending, actions.markSeen.bind(actions), confirmSeen);
    }

    isDraining = false;

    if (!stopped && (drainRequested || fullScanRequested || pendingChangedItems.size > 0)) {
      scheduleDrain();
    }
  }

  async function drain() {
    if (stopped) return;
    await runOutboxDrainExclusive(async () => {
      if (stopped) return;
      await scheduleSideEffect({
        queue: "outbox",
        source: "outbox",
        kind: "drain",
        timeoutMs: 120_000,
        slowMs: 1_000,
        run: () =>
          runBackgroundJob({
            kind: "outbox",
            source: "outbox",
            timeoutMs: 120_000,
            run: () => trackResetSensitiveOperation(drainNow()),
          }),
      });
    });
  }

  function scheduleDrain(event?: DocChangeEvent) {
    if (stopped) return;
    addDrainEvent(event);
    if (isDraining) {
      drainRequested = true;
      return;
    }
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drain().catch((err) => {
        if (isBackgroundRuntimeDeferredError(err)) {
          addDebugEvent("change", `[Outbox] drain deferred: ${formatBackgroundRuntimeDeferredReason(err.reason)}`);
          isDraining = false;
          scheduleDrain();
          return;
        }
        addDebugEvent("error", `[Outbox] drain threw: ${err instanceof Error ? err.message : String(err)}`);
        isDraining = false;
      });
    }, DEBOUNCE_MS);
  }

  unsubscribe = subscribe(scheduleDrain);

  const runtime: ActiveOutboxRuntime = {
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
    },
  };
  activeOutboxRuntime = runtime;

  // Run an immediate drain on startup (catch anything queued while offline)
  drain().catch((err) => {
    if (isBackgroundRuntimeDeferredError(err)) {
      addDebugEvent("change", `[Outbox] startup drain deferred: ${formatBackgroundRuntimeDeferredReason(err.reason)}`);
      isDraining = false;
      scheduleDrain();
      return;
    }
    addDebugEvent("error", `[Outbox] startup drain threw: ${err instanceof Error ? err.message : String(err)}`);
    isDraining = false;
  });

  // Return teardown
  return () => {
    runtime.stop();
    if (activeOutboxRuntime === runtime) activeOutboxRuntime = null;
  };
}

/** Stop future outbox scheduling and wait for an authorized action already in flight. */
export async function stopAndDrainOutboxProcessor(): Promise<void> {
  factoryResetDrainInProgress = true;
  activeOutboxRuntime?.stop();
  activeOutboxRuntime = null;
  await waitForFactoryResetDrain(
    () => [
      ...(activeDrain ? [activeDrain] : []),
      ...activeResetSensitiveOperations,
    ],
    "Social outbox",
    FACTORY_RESET_DRAIN_TIMEOUT_MS,
  );
}
