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
 *   - Retries up to MAX_RETRIES per item; after that writes sentinel -1.
 *   - Retry counts are in-memory only (not persisted across app restarts).
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
import { scheduleSideEffect } from "./side-effect-scheduler";
import {
  isBackgroundRuntimeDeferredError,
  runBackgroundJob,
} from "./background-runtime-coordinator";

// =============================================================================
// Constants
// =============================================================================

const DEBOUNCE_MS = 5_000;
const MAX_RETRIES = 3;
const SCAN_YIELD_EVERY = 500;

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
  // In-memory retry tracking: globalId -> { likeRetries, seenRetries }
  const retryMap = new Map<string, { likeRetries: number; seenRetries: number }>();

  function getRetries(id: string) {
    if (!retryMap.has(id)) retryMap.set(id, { likeRetries: 0, seenRetries: 0 });
    return retryMap.get(id)!;
  }

  function maybeDeleteRetries(id: string) {
    const retries = retryMap.get(id);
    if (!retries) return;
    if (retries.likeRetries === 0 && retries.seenRetries === 0) {
      retryMap.delete(id);
    }
  }

  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let isDraining = false;
  let drainRequested = false;
  let fullScanRequested = true;
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
      pendingChangedItems.set(item.globalId, item);
    }
  }

  function requeueItem(item: FeedItem) {
    pendingChangedItems.set(item.globalId, item);
  }

  // ── Core drain logic ────────────────────────────────────────────────────

  async function collectPendingQueues(items: FeedItem[]) {
    const likeQueue: FeedItem[] = [];
    const seenQueue: FeedItem[] = [];

    for (let index = 0; index < items.length; index += 1) {
      if (index > 0 && index % SCAN_YIELD_EVERY === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const item = items[index];
      const us = item.userState;

      if (us.liked && us.likedAt && !us.likedSyncedAt) {
        const retries = getRetries(item.globalId);
        if (retries.likeRetries < MAX_RETRIES) {
          likeQueue.push(item);
        }
      }

      if (us.readAt && !us.seenSyncedAt && item.sourceUrl) {
        const retries = getRetries(item.globalId);
        if (retries.seenRetries < MAX_RETRIES) {
          seenQueue.push(item);
        }
      }
    }

    return { likeQueue, seenQueue };
  }

  async function drainNow() {
    if (isDraining) return;
    isDraining = true;
    drainRequested = false;

    let items: FeedItem[];
    if (fullScanRequested) {
      const currentItems = getItems();
      if (!currentItems) {
        isDraining = false;
        return;
      }
      fullScanRequested = false;
      pendingChangedItems.clear();
      items = currentItems;
    } else {
      items = Array.from(pendingChangedItems.values());
      pendingChangedItems.clear();
    }

    if (items.length === 0) {
      isDraining = false;
      return;
    }

    const { likeQueue, seenQueue } = await collectPendingQueues(items);

    if (likeQueue.length > 0) {
      addDebugEvent("change", `[Outbox] draining ${likeQueue.length} pending like(s)`);
    }
    if (seenQueue.length > 0) {
      addDebugEvent("change", `[Outbox] draining ${seenQueue.length} pending seen(s)`);
    }

    for (const item of likeQueue) {
      const actions = platformActions.get(item.platform);
      if (!actions) continue;

      const retries = getRetries(item.globalId);
      try {
        const ok = await actions.like(item);
        if (ok) {
          retries.likeRetries = 0;
          await confirmLiked(item.globalId);
          maybeDeleteRetries(item.globalId);
          addDebugEvent("change", `[Outbox] liked ${item.globalId} on ${item.platform}`);
        } else {
          retries.likeRetries++;
          addDebugEvent("change", `[Outbox] like soft-fail #${retries.likeRetries} for ${item.globalId}`);
          if (retries.likeRetries >= MAX_RETRIES) {
            try { await confirmLiked(item.globalId, -1); } catch { /* logged below */ }
            retries.likeRetries = 0;
            maybeDeleteRetries(item.globalId);
            addDebugEvent("error", `[Outbox] like permanently failed for ${item.globalId}`);
          } else {
            requeueItem(item);
          }
        }
      } catch (err) {
        retries.likeRetries++;
        addDebugEvent("error", `[Outbox] like threw for ${item.globalId}: ${err instanceof Error ? err.message : String(err)}`);
        if (retries.likeRetries >= MAX_RETRIES) {
          try { await confirmLiked(item.globalId, -1); } catch { /* already logged */ }
          retries.likeRetries = 0;
          maybeDeleteRetries(item.globalId);
        } else {
          requeueItem(item);
        }
      }
    }

    for (const item of seenQueue) {
      const actions = platformActions.get(item.platform);
      if (!actions) continue;

      const retries = getRetries(item.globalId);
      try {
        const ok = await actions.markSeen(item);
        if (ok) {
          retries.seenRetries = 0;
          await confirmSeen(item.globalId);
          maybeDeleteRetries(item.globalId);
        } else {
          retries.seenRetries++;
          if (retries.seenRetries >= MAX_RETRIES) {
            try { await confirmSeen(item.globalId, -1); } catch { /* logged below */ }
            retries.seenRetries = 0;
            maybeDeleteRetries(item.globalId);
          } else {
            requeueItem(item);
          }
        }
      } catch (err) {
        retries.seenRetries++;
        addDebugEvent("error", `[Outbox] seen threw for ${item.globalId}: ${err instanceof Error ? err.message : String(err)}`);
        if (retries.seenRetries >= MAX_RETRIES) {
          try { await confirmSeen(item.globalId, -1); } catch { /* already logged */ }
          retries.seenRetries = 0;
          maybeDeleteRetries(item.globalId);
        } else {
          requeueItem(item);
        }
      }
    }

    isDraining = false;

    if (drainRequested || fullScanRequested || pendingChangedItems.size > 0) {
      scheduleDrain();
    }
  }

  async function drain() {
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
          run: drainNow,
        }),
    });
  }

  function scheduleDrain(event?: DocChangeEvent) {
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
          addDebugEvent("change", `[Outbox] drain deferred: ${err.reason}`);
          isDraining = false;
          scheduleDrain();
          return;
        }
        addDebugEvent("error", `[Outbox] drain threw: ${err instanceof Error ? err.message : String(err)}`);
        isDraining = false;
      });
    }, DEBOUNCE_MS);
  }

  // Subscribe to doc changes
  const unsubscribe = subscribe(scheduleDrain);

  // Run an immediate drain on startup (catch anything queued while offline)
  drain().catch((err) => {
    if (isBackgroundRuntimeDeferredError(err)) {
      addDebugEvent("change", `[Outbox] startup drain deferred: ${err.reason}`);
      isDraining = false;
      scheduleDrain();
      return;
    }
    addDebugEvent("error", `[Outbox] startup drain threw: ${err instanceof Error ? err.message : String(err)}`);
    isDraining = false;
  });

  // Return teardown
  return () => {
    unsubscribe();
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
  };
}
