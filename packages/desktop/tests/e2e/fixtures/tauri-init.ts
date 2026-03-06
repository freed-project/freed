/**
 * Tauri IPC shim for Playwright init scripts.
 *
 * Injected via page.addInitScript() BEFORE any page JavaScript runs. Sets up
 * window.__TAURI_MOCK_HANDLERS__ with sensible defaults for every command the
 * app calls on startup. Individual tests can override handlers after injection.
 *
 * This is the "reliable" mock path (runs before the Vite module graph fires).
 * The src/__mocks__/@tauri-apps/ module aliases are complementary -- they catch
 * anything the IIFE below misses.
 */

export function tauriInitScript(): string {
  return `(function () {
    // Handler map — tests override individual entries after page.addInitScript.
    window.__TAURI_MOCK_HANDLERS__ = {
      broadcast_doc: () => null,
      fetch_url: () => '',
      get_local_ip: () => '127.0.0.1',
      get_all_local_ips: () => [],
      get_sync_url: () => 'ws://127.0.0.1:8765',
      get_sync_client_count: () => 0,
      reset_pairing_token: () => null,
      start_relay: () => null,
      stop_relay: () => null,
      save_url_content: () => null,
      get_x_cookies: () => null,
      pick_contact: () => null,
    };
    window.__TAURI_MOCK_INVOCATIONS__ = [];
    window.__TAURI_MOCK_OPENED_URLS__ = [];
  })();`;
}
