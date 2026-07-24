/**
 * One-shot signal for "cloud sync has reconciled the local document".
 *
 * Startup maintenance (archive pruning, feed-item dedupe, title healing) must
 * not mutate the local document before cloud sync has merged the remote copy
 * into it, or it would delete rows the remote is about to reintroduce and churn
 * the merge. That constraint was previously expressed as "skip maintenance
 * whenever cloud credentials exist", which made the deferral permanent: on a
 * machine with Google Drive connected, archive pruning never ran at all.
 *
 * This module makes the deferral actually a deferral. Cloud sync marks the
 * document reconciled once its initial download has merged, and anything
 * waiting on that runs then.
 *
 * It lives in its own module so that store.ts and sync.ts can both use it
 * without importing each other.
 */

const reconciledProviders = new Set<string>();
let waiters: Array<() => void> = [];

export function markCloudReconciled(provider: string): void {
  const alreadyReconciled = reconciledProviders.size > 0;
  reconciledProviders.add(provider);
  if (alreadyReconciled) return;
  // First provider to reconcile releases the waiters. Later providers merge
  // into an already-reconciled document, so re-running maintenance for each one
  // would just repeat the same scan.
  const pending = waiters;
  waiters = [];
  for (const waiter of pending) {
    try {
      waiter();
    } catch {
      /* a failing waiter must not block the others */
    }
  }
}

export function isCloudReconciled(): boolean {
  return reconciledProviders.size > 0;
}

/**
 * Run `waiter` once the local document has been reconciled with a cloud copy.
 * Runs immediately when reconciliation already happened. Returns a cancel
 * function so a caller torn down before reconciliation does not leak.
 */
export function onCloudReconciled(waiter: () => void): () => void {
  if (isCloudReconciled()) {
    waiter();
    return () => {};
  }
  waiters.push(waiter);
  return () => {
    waiters = waiters.filter((candidate) => candidate !== waiter);
  };
}

export function resetCloudReconcileSignalForTests(): void {
  reconciledProviders.clear();
  waiters = [];
}
