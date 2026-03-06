/**
 * Mock for @tauri-apps/api/event
 *
 * `listen` is used by sync.ts to receive doc-change events from the relay.
 * In test mode we return a no-op unsubscribe so the rest of startSync()
 * completes without error.
 */

export type UnlistenFn = () => void;

export async function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {}
