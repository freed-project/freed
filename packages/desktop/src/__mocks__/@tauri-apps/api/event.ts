/**
 * Mock for @tauri-apps/api/event
 *
 * Stores listeners on window.__TAURI_EVENT_LISTENERS__ so E2E tests can
 * fire synthetic events (e.g. ig-auth-result, fb-feed-data) and exercise
 * the same code paths the real Tauri runtime would trigger.
 */

export type UnlistenFn = () => void;

type ListenerMap = Record<string, Array<(event: { payload: unknown }) => void>>;

function getListeners(): ListenerMap {
  const w = window as unknown as Record<string, unknown>;
  if (!w.__TAURI_EVENT_LISTENERS__) {
    w.__TAURI_EVENT_LISTENERS__ = {} as ListenerMap;
  }
  return w.__TAURI_EVENT_LISTENERS__ as ListenerMap;
}

export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  const map = getListeners();
  if (!map[event]) map[event] = [];
  const fn = handler as (event: { payload: unknown }) => void;
  map[event].push(fn);

  return () => {
    const arr = map[event];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  const map = getListeners();
  const arr = map[event];
  if (!arr) return;
  for (const fn of arr) {
    fn({ payload });
  }
}
