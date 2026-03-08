/**
 * Mock for @tauri-apps/api/core
 *
 * Activated when VITE_TEST_TAURI=1 is set. Each invoke() call is routed
 * through a per-command handler map so individual tests can override responses
 * without touching global state. All calls are recorded in
 * window.__TAURI_MOCK_INVOCATIONS__ for assertion.
 */

type Handler = (args: Record<string, unknown>) => unknown;

/** Default handlers for every command the app calls on startup. */
const handlers: Record<string, Handler> = {
  broadcast_doc: () => null,
  fetch_url: () => "",
  get_local_ip: () => "127.0.0.1",
  get_all_local_ips: () => [],
  get_sync_url: () => "ws://127.0.0.1:8765",
  get_sync_client_count: () => 0,
  reset_pairing_token: () => null,
  start_relay: () => null,
  stop_relay: () => null,
  save_url_content: () => null,
  get_x_cookies: () => null,
  open_x_login_window: () => null,
  check_x_login_cookies: () => ({ status: "closed" }),
  close_x_login_window: () => null,
  pick_contact: () => null,
};

// Expose handler map so tests and tauri-init.ts can override defaults.
(window as unknown as Record<string, unknown>).__TAURI_MOCK_HANDLERS__ = handlers;
// Append-only log of every invoke() call for test assertions.
(window as unknown as Record<string, unknown>).__TAURI_MOCK_INVOCATIONS__ = [] as Array<{
  cmd: string;
  args: Record<string, unknown> | undefined;
}>;

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  (
    (window as unknown as Record<string, unknown>).__TAURI_MOCK_INVOCATIONS__ as Array<{
      cmd: string;
      args: typeof args;
    }>
  ).push({ cmd, args });
  const handler =
    (
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_HANDLERS__ as Record<
        string,
        Handler
      >
    )[cmd] ?? (() => null);
  return handler(args ?? {}) as T;
}

export function isTauri(): boolean {
  return false;
}
