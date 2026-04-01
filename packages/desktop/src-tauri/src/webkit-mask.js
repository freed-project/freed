/**
 * WebKit Fingerprint Masking — injected before any page JavaScript runs.
 *
 * Goals:
 *  1. Make window.webkit.messageHandlers appear empty to fingerprinting code.
 *     Real Safari exposes this object but with no enumerable keys. A Tauri
 *     WKWebView with IPC wired up exposes registered handler names, which
 *     lets FB/IG distinguish WKWebView from real Safari.
 *
 *  2. Ensure document.hidden and document.visibilityState always report the
 *     page as visible. When the scraper window is behind the main app window,
 *     the real values would be "hidden" / "hidden", which FB/IG telemetry reads.
 *
 *  3. Set navigator.languages to a realistic locale list. WKWebView may expose
 *     an empty array or just ["en"], whereas real Safari includes ["en-US","en"].
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1. window.webkit.messageHandlers masking
  // ---------------------------------------------------------------------------
  // Only Tauri's internal IPC handler name(s) are allowed through. Everything
  // else returns undefined so the object looks empty to FB/IG fingerprinting.
  var _webkit = window.webkit;
  if (_webkit && _webkit.messageHandlers) {
    var _real = _webkit.messageHandlers;
    // Tauri v2 registers its IPC bridge under "ipc" (internal name).
    var _allowed = new Set(["ipc"]);

    try {
      Object.defineProperty(_webkit, "messageHandlers", {
        get: function () {
          return new Proxy(_real, {
            get: function (target, prop) {
              if (typeof prop === "symbol" || _allowed.has(prop)) {
                return target[prop];
              }
              return undefined;
            },
            has: function (target, prop) {
              return _allowed.has(prop) && prop in target;
            },
            ownKeys: function () {
              return [];
            },
            getOwnPropertyDescriptor: function () {
              return undefined;
            },
          });
        },
        configurable: false,
        enumerable: false,
      });
    } catch (_e) {
      // If defineProperty fails (e.g. already non-configurable), leave as-is.
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Page Visibility API — always report visible
  // ---------------------------------------------------------------------------
  // When the scraper window is behind the main Freed window, the real values
  // would expose that the page is backgrounded. FB/IG telemetry checks these.
  try {
    Object.defineProperty(document, "hidden", {
      get: function () { return false; },
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      get: function () { return "visible"; },
      configurable: true,
    });
    // Prevent visibilitychange events from firing with wrong state.
    var _originalAEL = document.addEventListener.bind(document);
    document.addEventListener = function (type, listener, options) {
      if (type === "visibilitychange") return;
      return _originalAEL(type, listener, options);
    };
  } catch (_e) {}

  // ---------------------------------------------------------------------------
  // 3. navigator.languages — set realistic locale list
  // ---------------------------------------------------------------------------
  // WKWebView may expose [] or ["en"]. Real Safari returns ["en-US","en"] or
  // the user's configured system locale list.
  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, "languages", {
        get: function () { return ["en-US", "en"]; },
        configurable: true,
      });
    }
  } catch (_e) {}

})();
