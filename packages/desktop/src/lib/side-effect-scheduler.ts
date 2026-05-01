import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger";

export type SideEffectQueue =
  | "diagnostics"
  | "nativeStore"
  | "outbox"
  | "persistence"
  | "snapshot"
  | "sync";

export interface SideEffectTask<T> {
  queue: SideEffectQueue;
  source: string;
  kind: string;
  timeoutMs?: number;
  slowMs?: number;
  run: () => Promise<T> | T;
}

interface QueueState {
  tail: Promise<void>;
  pending: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SLOW_MS = 750;

const queues = new Map<SideEffectQueue, QueueState>();

function queueState(queue: SideEffectQueue): QueueState {
  const existing = queues.get(queue);
  if (existing) return existing;
  const state: QueueState = { tail: Promise.resolve(), pending: 0 };
  queues.set(queue, state);
  return state;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function formatTrace(task: SideEffectTask<unknown>, detail: string): string {
  return `[side-effect] queue=${task.queue} source=${task.source} kind=${task.kind} ${detail}`;
}

function logSlowTask(task: SideEffectTask<unknown>, detail: string): void {
  const message = formatTrace(task, detail);
  log.info(message);
  addDebugEvent("change", message);
}

async function withTimeout<T>(task: SideEffectTask<T>): Promise<T> {
  const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const runPromise = Promise.resolve().then(task.run);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          formatTrace(
            task,
            `timed_out_ms=${timeoutMs.toLocaleString()}`,
          ),
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    runPromise.catch(() => {
      // The raced timeout already reported failure to the caller.
    });
  }
}

export function scheduleSideEffect<T>(task: SideEffectTask<T>): Promise<T> {
  const state = queueState(task.queue);
  const enqueuedAt = performance.now();
  const pendingBeforeStart = state.pending;
  state.pending += 1;

  const work = state.tail.catch(() => {
    // Keep this queue alive after failed tasks.
  }).then(async () => {
    state.pending = Math.max(0, state.pending - 1);
    const startedAt = performance.now();
    const waitMs = elapsedMs(enqueuedAt);
    const result = await withTimeout(task);
    const durationMs = elapsedMs(startedAt);
    const slowMs = task.slowMs ?? DEFAULT_SLOW_MS;
    if (waitMs >= slowMs || durationMs >= slowMs || pendingBeforeStart > 0) {
      logSlowTask(
        task,
        `wait_ms=${waitMs.toLocaleString()} duration_ms=${durationMs.toLocaleString()} pending_before=${pendingBeforeStart.toLocaleString()}`,
      );
    }
    return result;
  });

  state.tail = work.then(
    () => undefined,
    () => undefined,
  );
  return work;
}

export function getSideEffectQueueDepth(queue: SideEffectQueue): number {
  return queueState(queue).pending;
}
