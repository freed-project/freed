const WORKER_DEBUG_STORAGE_KEY = "freed:pwa:automerge-worker-debug:v1";
const MAX_PERSISTED_WORKER_DEBUG_EVENTS = 30;

export interface PersistedWorkerDebugEvent {
  ts: number;
  kind: string;
  detail?: string;
  bytes?: number;
}

export function getPersistedWorkerDebugEvents(): PersistedWorkerDebugEvent[] {
  try {
    const raw = window.localStorage.getItem(WORKER_DEBUG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PersistedWorkerDebugEvent => (
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.ts === "number" &&
      typeof entry.kind === "string"
    ));
  } catch {
    return [];
  }
}

export function persistWorkerDebugEvent(event: Omit<PersistedWorkerDebugEvent, "ts">): void {
  try {
    const nextEvents = [
      { ...event, ts: Date.now() },
      ...getPersistedWorkerDebugEvents(),
    ].slice(0, MAX_PERSISTED_WORKER_DEBUG_EVENTS);
    window.localStorage.setItem(WORKER_DEBUG_STORAGE_KEY, JSON.stringify(nextEvents));
  } catch {
    // Diagnostics should never affect sync behavior.
  }
}

/** Remove persisted worker diagnostics during a destructive local reset. */
export function clearPersistedWorkerDebugEvents(): void {
  window.localStorage.removeItem(WORKER_DEBUG_STORAGE_KEY);
}
