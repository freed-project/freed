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
import { addDebugEvent } from "@freed/ui/lib/debug-store";

// =============================================================================
// Constants
// =============================================================================

const DEBOUNCE_MS = 5_000;
const MAX_RETRIES = 3;

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
  subscribe: (cb: () => void) => () => void,
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

  // ── Core drain logic ────────────────────────────────────────────────────

  async function drain() {
    if (isDraining) return;
    isDraining = true;

    const items = getItems();
    if (!items) {
      isDraining = false;
      return;
    }

    const likeQueue: FeedItem[] = [];
    const seenQueue: FeedItem[] = [];

    for (const item of items) {
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
          }
        }
      } catch (err) {
        retries.likeRetries++;
        addDebugEvent("error", `[Outbox] like threw for ${item.globalId}: ${err instanceof Error ? err.message : String(err)}`);
        if (retries.likeRetries >= MAX_RETRIES) {
          try { await confirmLiked(item.globalId, -1); } catch { /* already logged */ }
          retries.likeRetries = 0;
          maybeDeleteRetries(item.globalId);
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
          }
        }
      } catch (err) {
        retries.seenRetries++;
        addDebugEvent("error", `[Outbox] seen threw for ${item.globalId}: ${err instanceof Error ? err.message : String(err)}`);
        if (retries.seenRetries >= MAX_RETRIES) {
          try { await confirmSeen(item.globalId, -1); } catch { /* already logged */ }
          retries.seenRetries = 0;
          maybeDeleteRetries(item.globalId);
        }
      }
    }

    isDraining = false;

    // If new items arrived during drain, schedule another pass so they
    // don't sit in the outbox until the next external doc change.
    if (hasPendingItems(getItems())) {
      scheduleDrain();
    }
  }

  /** Quick check for any items that still need outbox processing. */
  function hasPendingItems(items: FeedItem[] | null): boolean {
    if (!items) return false;
    for (const item of items) {
      const us = item.userState;
      if (us.liked && us.likedAt && !us.likedSyncedAt) {
        const r = retryMap.get(item.globalId);
        if (!r || r.likeRetries < MAX_RETRIES) return true;
      }
      if (us.readAt && !us.seenSyncedAt && item.sourceUrl) {
        const r = retryMap.get(item.globalId);
        if (!r || r.seenRetries < MAX_RETRIES) return true;
      }
    }
    return false;
  }

  function scheduleDrain() {
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drain().catch((err) => {
        addDebugEvent("error", `[Outbox] drain threw: ${err instanceof Error ? err.message : String(err)}`);
        isDraining = false;
      });
    }, DEBOUNCE_MS);
  }

  // Subscribe to doc changes
  const unsubscribe = subscribe(scheduleDrain);

  // Run an immediate drain on startup (catch anything queued while offline)
  drain().catch((err) => {
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
