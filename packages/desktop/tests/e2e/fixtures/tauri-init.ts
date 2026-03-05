/**
 * Tauri IPC mock injected via page.addInitScript().
 *
 * This file is NOT imported by the Playwright test runner — it is serialised
 * to a string and injected into every page before navigation. It therefore
 * must be self-contained: no external imports, TypeScript types only inline.
 *
 * The script sets up window.__TAURI_INTERNALS__ to satisfy the real (pre-
 * bundled) @tauri-apps/api package, and wires a handler registry so tests can
 * override individual commands without rebuilding the Vite bundle.
 *
 * Signature confirmed from the pre-bundled chunk:
 *   window.__TAURI_INTERNALS__.invoke(cmd, args, options) -> Promise<T>
 */
export function tauriInitScript(): string {
  return /* js */ `
(function () {
  // IPC handler registry — keyed by exact command name.
  // Tests can call window.__TAURI_MOCK_SET_HANDLER__(cmd, fn) after page load.
  var _handlers = {};

  // Tracking arrays exposed for test assertions.
  window.__TAURI_MOCK_OPENED_URLS__  = [];
  window.__TAURI_MOCK_PROCESS_CALLS__ = [];

  // Default handlers for every plugin command the app uses on startup.
  var _defaults = {
    // Sync relay (automerge.ts)
    'broadcast_doc': function () { return null; },
    'get_local_ip':  function () { return '127.0.0.1'; },
    'get_all_local_ips': function () { return []; },

    // plugin-store (secure-storage.ts)
    'plugin:store|load_store': function () { return { rid: 1 }; },
    'plugin:store|get_all':    function () { return []; },
    'plugin:store|get':        function () { return null; },
    'plugin:store|set':        function () { return null; },
    'plugin:store|delete':     function () { return false; },
    'plugin:store|clear':      function () { return null; },
    'plugin:store|reset':      function () { return null; },
    'plugin:store|has':        function () { return false; },
    'plugin:store|keys':       function () { return []; },
    'plugin:store|values':     function () { return []; },
    'plugin:store|entries':    function () { return []; },
    'plugin:store|length':     function () { return 0; },
    'plugin:store|close':      function () { return null; },

    // plugin-updater (App.tsx)
    'plugin:updater|check':          function () { return window.__TAURI_MOCK_UPDATE__ || null; },
    'plugin:updater|check_update':   function () { return window.__TAURI_MOCK_UPDATE__ || null; },
    'plugin:updater|download_update': function () { return null; },
    'plugin:updater|install_update':  function () { return null; },

    // plugin-process (App.tsx)
    'plugin:process|relaunch': function () {
      window.__TAURI_MOCK_PROCESS_CALLS__.push({ fn: 'relaunch', args: [] });
      return null;
    },
    'plugin:process|exit': function (_cmd, args) {
      window.__TAURI_MOCK_PROCESS_CALLS__.push({ fn: 'exit', args: [args && args.code] });
      return null;
    },

    // plugin-shell (sync.ts)
    'plugin:shell|open': function (_cmd, args) {
      var url = args && (args.url || args.path || String(args));
      if (url) window.__TAURI_MOCK_OPENED_URLS__.push(url);
      return null;
    },
    'plugin:shell|execute': function () { return { code: 0, stdout: '', stderr: '' }; },

    // plugin-fs (content-cache.ts)
    'plugin:fs|read_file':    function () { return []; },
    'plugin:fs|write_file':   function () { return null; },
    'plugin:fs|exists':       function () { return false; },
    'plugin:fs|mkdir':        function () { return null; },
    'plugin:fs|remove':       function () { return null; },
    'plugin:fs|rename':       function () { return null; },
    'plugin:fs|stat':         function () { return { isFile: false, isDirectory: false, size: 0 }; },
    'plugin:fs|read_dir':     function () { return []; },
    'plugin:fs|copy_file':    function () { return null; },
    'plugin:fs|read_text_file':  function () { return ''; },
    'plugin:fs|write_text_file': function () { return null; },
    'plugin:fs|base_directory':  function () { return '/mock'; },
    'plugin:fs|resolve_path':    function () { return '/mock/path'; },

    // path plugin (content-cache.ts)
    'plugin:path|resolve_path': function () { return '/mock/path'; },
    'plugin:fs|app_data_dir':   function () { return '/mock/app-data'; },
  };

  function _resolve(cmd, args) {
    var handler = _handlers[cmd] || _defaults[cmd] || _defaults['*'];
    if (!handler) return Promise.resolve(null);
    try {
      var result = handler(cmd, args);
      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow:  { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' },
    },

    transformCallback: function (callback, once) {
      var id   = Math.round(Math.random() * 2147483647);
      var slot = '_' + id;
      Object.defineProperty(window, slot, {
        get: function () {
          if (once) { try { delete window[slot]; } catch (_) {} }
          return callback;
        },
        configurable: true,
      });
      return id;
    },

    unregisterCallback: function (id) {
      try { delete window['_' + id]; } catch (_) {}
    },

    convertFileSrc: function (path, protocol) {
      return (protocol || 'asset') + '://localhost/' + path;
    },

    // Main IPC entry point. Returns a Promise (Tauri v2 signature).
    invoke: function (cmd, args, _options) {
      return _resolve(cmd, args);
    },
  };

  // Expose helpers for Playwright test code (via page.evaluate / ipc fixture).
  window.__TAURI_MOCK_SET_HANDLER__ = function (cmd, fn) {
    _handlers[cmd] = fn;
  };

  window.__TAURI_MOCK_CLEAR_HANDLERS__ = function () {
    _handlers = {};
  };

  // Direct invoke for assertions in page.evaluate() without dynamic imports.
  window.__TAURI_MOCK_INVOKE__ = function (cmd, args) {
    return _resolve(cmd, args);
  };
})();
  `;
}
