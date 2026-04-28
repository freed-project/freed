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
      google_api_request: () => '{"connections":[],"nextSyncToken":"test-sync-token"}',
      fetch_binary_url: () => [],
      get_local_ip: () => '127.0.0.1',
      get_all_local_ips: () => [],
      get_sync_url: () => 'ws://127.0.0.1:8765',
      sha256_file: () => '',
      get_sync_client_count: () => 0,
      get_runtime_memory_stats: () => ({
        processResidentBytes: 64 * 1024 * 1024,
        processVirtualBytes: 256 * 1024 * 1024,
        webkitResidentBytes: 96 * 1024 * 1024,
        webkitVirtualBytes: 512 * 1024 * 1024,
        webkitProcessId: 12345,
        webkitTelemetryAvailable: true,
        indexedDbBytes: 8 * 1024 * 1024,
        webkitCacheBytes: 16 * 1024 * 1024,
        relayDocBytes: 0,
        relayClientCount: 0,
      }),
      get_updater_target: () => 'darwin-aarch64',
      retry_startup_after_crash: () => null,
      reset_pairing_token: () => null,
      get_recent_logs: () => [],
      start_relay: () => null,
      stop_relay: () => null,
      list_snapshots: () => [],
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
      fb_scrape_comments: () => null,
      fb_disconnect: () => null,
      ig_show_login: () => null,
      ig_hide_login: () => null,
      ig_check_auth: () => true,
      ig_scrape_feed: () => null,
      ig_scrape_comments: () => null,
      ig_disconnect: () => null,
      li_show_login: () => null,
      li_hide_login: () => null,
      li_check_auth: () => true,
      li_scrape_feed: () => null,
      li_disconnect: () => null,
    };
    window.__TAURI_MOCK_INVOCATIONS__ = [];
    window.__TAURI_MOCK_OPENED_URLS__ = [];
    window.__TAURI_MOCK_WINDOW_DRAG_CALLS__ = [];
    window.__TAURI_MOCK_CALLBACKS__ = {};
    window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__ = {};
    window.__TAURI_MOCK_UPDATE_CHECK_CALLS__ = [];

    var nextCallbackId = 1;
    var nextPluginEventId = 1;
    window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: function(event, eventId) {
        var record = window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[eventId];
        if (record && record.event === event) {
          delete window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[eventId];
        }
      }
    };
    window.__TAURI_INTERNALS__.invoke = function(cmd, args) {
      window.__TAURI_MOCK_INVOCATIONS__.push({ cmd: cmd, args: args });
      if (cmd === 'plugin:event|listen') {
        var eventId = nextPluginEventId++;
        window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[eventId] = {
          event: String((args && args.event) || ''),
          callbackId: Number((args && args.handler) || 0)
        };
        return Promise.resolve(eventId);
      }
      if (cmd === 'plugin:event|unlisten') {
        delete window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[Number((args && args.eventId) || 0)];
        return Promise.resolve(null);
      }
      if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
        var eventName = String((args && args.event) || '');
        var payload = args && args.payload;
        Object.keys(window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__).forEach(function(id) {
          var record = window.__TAURI_MOCK_PLUGIN_EVENT_LISTENERS__[id];
          if (!record || record.event !== eventName) return;
          var callback = window.__TAURI_MOCK_CALLBACKS__[record.callbackId];
          if (typeof callback === 'function') {
            callback({
              event: eventName,
              id: Number(id),
              payload: payload,
              windowLabel: 'main'
            });
          }
        });
        return Promise.resolve(null);
      }
      var handler = window.__TAURI_MOCK_HANDLERS__[cmd];
      return Promise.resolve(handler ? handler(args || {}) : null);
    };
    window.__TAURI_INTERNALS__.transformCallback = function(callback) {
      var id = nextCallbackId++;
      window.__TAURI_MOCK_CALLBACKS__[id] = callback;
      return id;
    };
    window.__TAURI_INTERNALS__.unregisterCallback = function(id) {
      delete window.__TAURI_MOCK_CALLBACKS__[id];
    };
    window.__TAURI_INTERNALS__.callbacks = window.__TAURI_MOCK_CALLBACKS__;
    window.__TAURI_INTERNALS__.metadata = window.__TAURI_INTERNALS__.metadata || {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' }
    };
    window.__TAURI_INTERNALS__.convertFileSrc =
      window.__TAURI_INTERNALS__.convertFileSrc || function(filePath) { return filePath; };
    window.__TAURI_INTERNALS__.plugins = window.__TAURI_INTERNALS__.plugins || {
      path: { sep: '/', delimiter: ':' }
    };
  })();`;
}
