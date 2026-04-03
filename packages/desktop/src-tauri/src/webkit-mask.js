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
  var CLOAK_WINDOW_NAME = "__freed_background_scraper__";
  var MEDIA_GUARD_WINDOW_NAME = "__freed_media_guard__";
  var CLOAK_STYLE_ID = "__freed_scraper_cloak__";
  var MEDIA_GUARD_STATE_KEY = "__freedBackgroundScraperMediaGuardState__";
  var MEDIA_GUARD_BOUND_KEY = "__freedMediaGuardBound__";
  var MEDIA_GUARD_REPORTED_KEY = "__freedMediaGuardReported__";
  var MAX_MEDIA_DIAG_EVENTS = 8;
  var cloakIntervalId = null;

  function emit(name, data) {
    if (
      window.__TAURI__ &&
      window.__TAURI__.event &&
      typeof window.__TAURI__.event.emit === "function"
    ) {
      window.__TAURI__.event.emit(name, data);
    }
  }

  function setWindowNameToken(token, enabled) {
    var tokens = (window.name || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (value) {
        return value !== token;
      });

    if (enabled) {
      tokens.push(token);
    }

    window.name = tokens.join(" ");
  }

  function ensureCloakStyle() {
    var root = document.documentElement;
    if (!root) return;

    var style = document.getElementById(CLOAK_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = CLOAK_STYLE_ID;
      style.textContent = "html, body { background: transparent !important; opacity: 0 !important; }";
      (document.head || root).appendChild(style);
    }

    root.style.setProperty("background", "transparent", "important");
    root.style.setProperty("opacity", "0", "important");
    if (document.body) {
      document.body.style.setProperty("background", "transparent", "important");
      document.body.style.setProperty("opacity", "0", "important");
    }
  }

  function clearCloakStyle() {
    var root = document.documentElement;
    var style = document.getElementById(CLOAK_STYLE_ID);
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }

    if (root) {
      root.style.removeProperty("background");
      root.style.removeProperty("opacity");
    }
    if (document.body) {
      document.body.style.removeProperty("background");
      document.body.style.removeProperty("opacity");
    }
  }

  function setBackgroundScraperCloak(enabled) {
    if (enabled) {
      ensureCloakStyle();
      if (cloakIntervalId === null) {
        cloakIntervalId = window.setInterval(ensureCloakStyle, 500);
      }
      return;
    }

    if (cloakIntervalId !== null) {
      window.clearInterval(cloakIntervalId);
      cloakIntervalId = null;
    }
    clearCloakStyle();
  }

  window.__FREED_SET_BACKGROUND_SCRAPER_CLOAK__ = setBackgroundScraperCloak;

  function getMediaGuardState() {
    if (!window[MEDIA_GUARD_STATE_KEY]) {
      window[MEDIA_GUARD_STATE_KEY] = {
        enabled: false,
        observer: null,
        diagCount: 0,
      };
    }
    return window[MEDIA_GUARD_STATE_KEY];
  }

  function reportMediaSilenced(mediaEl, reason) {
    var state = getMediaGuardState();
    if (state.diagCount >= MAX_MEDIA_DIAG_EVENTS) return;
    if (mediaEl[MEDIA_GUARD_REPORTED_KEY]) return;

    mediaEl[MEDIA_GUARD_REPORTED_KEY] = true;
    state.diagCount += 1;

    emit("freed-scraper-media-diag", {
      provider: (window.location.hostname || "unknown").replace(/^www\./, ""),
      kind: mediaEl.tagName.toLowerCase(),
      reason: reason,
    });
  }

  function silenceMediaElement(mediaEl, reason) {
    if (!(mediaEl instanceof HTMLMediaElement)) return;

    try {
      mediaEl.defaultMuted = true;
    } catch (_e) {}
    try {
      mediaEl.muted = true;
    } catch (_e) {}
    try {
      mediaEl.volume = 0;
    } catch (_e) {}
    try {
      mediaEl.setAttribute("muted", "");
    } catch (_e) {}

    if (mediaEl instanceof HTMLAudioElement) {
      try {
        mediaEl.pause();
      } catch (_e) {}
    }

    reportMediaSilenced(mediaEl, reason);
  }

  function bindMediaElement(mediaEl) {
    if (!(mediaEl instanceof HTMLMediaElement)) return;
    if (mediaEl[MEDIA_GUARD_BOUND_KEY]) {
      silenceMediaElement(mediaEl, "re-scan");
      return;
    }

    mediaEl[MEDIA_GUARD_BOUND_KEY] = true;

    var enforce = function (event) {
      silenceMediaElement(
        mediaEl,
        event && event.type ? event.type : "media-event"
      );
    };

    mediaEl.addEventListener("play", enforce, true);
    mediaEl.addEventListener("volumechange", enforce, true);
    mediaEl.addEventListener("loadedmetadata", enforce, true);

    silenceMediaElement(mediaEl, "initial-scan");
  }

  function scanNodeForMedia(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) return;

    if (node instanceof HTMLMediaElement) {
      bindMediaElement(node);
    }

    if (typeof node.querySelectorAll !== "function") return;

    var mediaNodes = node.querySelectorAll("audio, video");
    for (var i = 0; i < mediaNodes.length; i++) {
      bindMediaElement(mediaNodes[i]);
    }
  }

  function refreshMediaGuardObserver() {
    var state = getMediaGuardState();

    if (!state.enabled) {
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }
      return;
    }

    scanNodeForMedia(document.documentElement || document.body);

    if (state.observer || !document.documentElement) return;

    state.observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          scanNodeForMedia(mutation.addedNodes[j]);
        }
      }
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function setBackgroundScraperMediaGuard(enabled) {
    var state = getMediaGuardState();
    state.enabled = !!enabled;
    setWindowNameToken(MEDIA_GUARD_WINDOW_NAME, state.enabled);
    refreshMediaGuardObserver();
  }

  window.__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__ =
    setBackgroundScraperMediaGuard;

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

  if ((window.name || "").indexOf(CLOAK_WINDOW_NAME) !== -1) {
    setBackgroundScraperCloak(true);
  }

  if ((window.name || "").indexOf(MEDIA_GUARD_WINDOW_NAME) !== -1) {
    setBackgroundScraperMediaGuard(true);
  }

  document.addEventListener(
    "DOMContentLoaded",
    function () {
      if ((window.name || "").indexOf(CLOAK_WINDOW_NAME) !== -1) {
        setBackgroundScraperCloak(true);
      }
      if ((window.name || "").indexOf(MEDIA_GUARD_WINDOW_NAME) !== -1) {
        setBackgroundScraperMediaGuard(true);
      }
    },
    { once: true }
  );

})();
