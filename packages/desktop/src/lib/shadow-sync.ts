/**
 * Wires the shadow store to the live document.
 *
 * Stage 5 of the storage roadmap, and the first piece of this series that runs
 * at all. Everything before it was a dead path proved correct in isolation:
 * the projection, its losslessness proof against the owner's real 15,846-item
 * library, the SQLite schema, and the drift detector. This subscribes them to
 * the running application.
 *
 * ## Off by default, and why that is not timidity
 *
 * The store is still a shadow. Nothing reads it, so a bug here can only cost
 * CPU and disk, never correctness. But it writes on every document change on
 * the main thread, and the whole point of this programme is that the main
 * thread is where Freed runs out of room. Shipping a projector that is quietly
 * expensive would be a self-inflicted wound in exactly the place we are trying
 * to heal, so it starts disabled and is measured before it is trusted.
 *
 * ## Two paths, because patches cannot cover everything
 *
 * `DocChangeEvent` distinguishes them for us. An event carrying
 * `changedItemIds` describes a specific mutation and is applied incrementally.
 * An event with `requiresFullScan` replaced the state wholesale, and there is
 * no patch to apply, so the store is reconciled against the document instead.
 *
 * ## Reconciliation is chunked
 *
 * A full reconcile compares every item in the library. On the owner's corpus
 * that is 15,846 projections, and doing it in one synchronous pass on the main
 * thread would drop frames during startup, which is precisely the sort of
 * regression a memory project should not introduce. It runs in bounded slices
 * yielding between each, and a reconcile already in flight is not started
 * again.
 */

import { invoke } from "@tauri-apps/api/core";

import { projectFeedItem } from "@freed/shared";
import type { FeedItem } from "@freed/shared";
import type { DocChangeEvent, DocState } from "./automerge-types";
import { log } from "./logger.js";
import { recordRuntimeHealthEvent } from "./runtime-health-events";

/** Rows per IPC call. Large enough to amortise the round trip, small enough not to block. */
const UPSERT_CHUNK = 500;
/** Items compared per reconcile slice before yielding back to the event loop. */
const RECONCILE_SLICE = 1_000;

const FLAG_KEY = "freed-shadow-store-enabled";

export function shadowStoreEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function upsert(rows: ReturnType<typeof projectFeedItem>[]): Promise<void> {
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK) {
    await invoke("shadow_store_upsert", { rows: rows.slice(index, index + UPSERT_CHUNK) });
    if (index + UPSERT_CHUNK < rows.length) await yieldToEventLoop();
  }
}

async function remove(globalIds: string[]): Promise<void> {
  if (globalIds.length === 0) return;
  await invoke("shadow_store_delete", { globalIds });
}

let reconcileInFlight = false;

/**
 * Bring the store into agreement with the document, in slices.
 *
 * Deliberately compares ids rather than full rows. A value-level comparison
 * would need every stored row read back across IPC, which on a full library is
 * far more expensive than the write it is checking. Row-level divergence is
 * what the Stage 4 differ is for, run deliberately rather than on every
 * startup.
 */
export async function reconcile(state: DocState): Promise<void> {
  if (reconcileInFlight) return;
  reconcileInFlight = true;
  const startedAt = Date.now();
  try {
    const storedIds = new Set(await invoke<string[]>("shadow_store_ids"));
    const items = state.items as unknown as FeedItem[];

    const missing: FeedItem[] = [];
    const present = new Set<string>();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      present.add(item.globalId);
      if (!storedIds.has(item.globalId)) missing.push(item);
      if (index > 0 && index % RECONCILE_SLICE === 0) await yieldToEventLoop();
    }

    const stale: string[] = [];
    for (const id of storedIds) if (!present.has(id)) stale.push(id);

    if (missing.length > 0) await upsert(missing.map((item) => projectFeedItem(item)));
    await remove(stale);

    recordRuntimeHealthEvent({
      event: "shadow_store_reconciled",
      itemsInDocument: items.length,
      rowsBefore: storedIds.size,
      inserted: missing.length,
      removed: stale.length,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    reconcileInFlight = false;
  }
}

async function applyIncremental(event: DocChangeEvent): Promise<void> {
  const changedIds = event.changedItemIds ?? [];
  const changedItems = (event.changedItems ?? []) as unknown as FeedItem[];
  if (changedIds.length === 0 && changedItems.length === 0) return;

  const supplied = new Set(changedItems.map((item) => item.globalId));
  // An id the mutation reported as changed but supplied no item for is a
  // deletion. The worker filters its patch payload to items that still exist,
  // so this is what a delete looks like from here.
  const removed = changedIds.filter((id) => !supplied.has(id));

  if (changedItems.length > 0) await upsert(changedItems.map((item) => projectFeedItem(item)));
  await remove(removed);
}

let unsubscribe: (() => void) | null = null;

/**
 * Start mirroring document changes into the shadow store.
 *
 * Returns a stop function. Safe to call when the flag is off, in which case it
 * does nothing and returns a no-op, so callers do not need to branch.
 */
export function startShadowSync(
  subscribe: (callback: (state: DocState, event: DocChangeEvent) => void) => () => void,
  getState: () => DocState | null,
): () => void {
  if (!shadowStoreEnabled()) return () => {};
  if (unsubscribe !== null) return unsubscribe;

  // Failures are logged and swallowed on purpose. Nothing reads these rows, so
  // a projector that cannot write must never be able to break the application
  // it is shadowing. This changes at Stage 8, when the store becomes the
  // writer and a failure has to surface.
  const guard = (work: Promise<void>, context: string): void => {
    work.catch((error) => {
      log.warn(`[shadow-sync] ${context} failed: ${String(error)}`);
      recordRuntimeHealthEvent({ event: "shadow_store_error", context, message: String(error) });
    });
  };

  const initial = getState();
  if (initial !== null) guard(reconcile(initial), "initial reconcile");

  unsubscribe = subscribe((state, event) => {
    if (event.requiresFullScan) {
      // State was replaced wholesale; there is no patch to apply.
      guard(reconcile(state), "reconcile");
      return;
    }
    guard(applyIncremental(event), "incremental");
  });

  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}
