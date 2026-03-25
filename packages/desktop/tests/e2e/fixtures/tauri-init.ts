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
    // Handler map - tests override individual entries after page.addInitScript.
    // The broadcast_doc handler wraps the real call to capture IPC timing data
    // consumed by the IPC latency harness in perf-feed.spec.ts.
    window.__TAURI_MOCK_IPC_TIMINGS__ = [];
    function timedHandler(cmd, fn) {
      return function(args) {
        var start = performance.now();
        var result = fn(args);
        window.__TAURI_MOCK_IPC_TIMINGS__.push({ cmd: cmd, startMs: start, endMs: performance.now(), args: args });
        return result;
      };
    }
    window.__TAURI_MOCK_HANDLERS__ = {
      broadcast_doc: timedHandler('broadcast_doc', function() { return null; }),
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
      open_x_login_window: () => null,
      check_x_login_cookies: () => ({ status: 'closed' }),
      close_x_login_window: () => null,
      pick_contact: () => null,
      fb_show_login: () => null,
      fb_hide_login: () => null,
      fb_check_auth: () => true,
      fb_scrape_feed: () => null,
      fb_scrape_groups: () => [],
      fb_disconnect: () => null,
      ig_show_login: () => null,
      ig_hide_login: () => null,
      ig_check_auth: () => true,
      ig_scrape_feed: () => null,
      ig_disconnect: () => null,
    };
    window.__TAURI_MOCK_INVOCATIONS__ = [];
    window.__TAURI_MOCK_OPENED_URLS__ = [];
  })();`;
}
