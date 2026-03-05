/**
 * Mock for @tauri-apps/api/event used when VITE_TEST_TAURI=1.
 *
 * listen() and once() return an unlisten function that is a no-op. Tests that
 * need to simulate Tauri events can use window.__TAURI_MOCK_EMIT__ which is
 * also set up here.
 */

type UnlistenFn = () => void;
type EventHandler<T> = (event: { event: string; payload: T; id: number }) => void;

const listeners = new Map<string, Set<EventHandler<unknown>>>();

// Expose an emit helper so Playwright tests can simulate backend events.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TAURI_MOCK_EMIT__ = <T>(
    event: string,
    payload: T,
  ) => {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const h of handlers) {
      h({ event, payload, id: 0 });
    }
  };
}

export async function listen<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<UnlistenFn> {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler as EventHandler<unknown>);
  return () => listeners.get(event)?.delete(handler as EventHandler<unknown>);
}

export async function once<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<UnlistenFn> {
  const wrapper: EventHandler<T> = (e) => {
    handler(e);
    listeners.get(event)?.delete(wrapper as EventHandler<unknown>);
  };
  return listen(event, wrapper);
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  const handlers = listeners.get(event);
  if (!handlers) return;
  for (const h of handlers) {
    h({ event, payload, id: 0 });
  }
}

export async function emitTo(
  _target: string,
  event: string,
  payload?: unknown,
): Promise<void> {
  return emit(event, payload);
}
