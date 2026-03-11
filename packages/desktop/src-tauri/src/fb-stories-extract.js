// Facebook story viewer extraction script.
// Injected by the Rust story navigation loop immediately after each story frame
// becomes visible. Extracts author, media, timestamp, and location/check-in
// from the full-screen Facebook story overlay, then emits via fb-feed-data so
// the existing TypeScript accumulator treats stories identically to feed posts.
//
// Facebook story viewer DOM (2025-2026):
//   - Full-screen overlay, typically role="dialog" or a fixed-position div
//   - Author: h3 or span with the friend's name + avatar img in the header
//   - Media: full-bleed img or video element
//   - Location / check-in: may appear as a tappable element or text overlay
//   - Navigation: left/right arrow buttons outside the media area
//   - Story ID: embedded in query params (?story_fbid=...) or URL path
(function () {
  "use strict";

  var emit =
    window.__TAURI__ &&
    window.__TAURI__.event &&
    typeof window.__TAURI__.event.emit === "function"
      ? function (name, data) {
          window.__TAURI__.event.emit(name, data);
        }
      : function () {};

  // ── Extract story ID from current URL ────────────────────────────────────

  function extractStoryId() {
    var href = window.location.href;
    var m =
      href.match(/story_fbid=(\d+)/) ||
      href.match(/\/stories\/(\d+)/) ||
      href.match(/(pfbid[A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }

  // ── Find the active story viewer container ────────────────────────────────

  function findStoryContainer() {
    // Strategy 1: dialog role (most reliable on desktop FB)
    var dialog = document.querySelector('[role="dialog"]');
    if (dialog && dialog.offsetHeight > 400) return dialog;

    // Strategy 2: fixed-position fullscreen div
    var all = document.querySelectorAll("div");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Full-viewport height, fixed/absolute, and contains media
      if (
        el.offsetHeight > window.innerHeight * 0.75 &&
        (el.querySelector("video") ||
          el.querySelector('img[src*="scontent"], img[src*="fbcdn"]'))
      ) {
        // Make sure it's not a tiny ancestor wrapping the whole page
        if (el.offsetWidth > window.innerWidth * 0.3) {
          return el;
        }
      }
    }

    // Strategy 3: look for the story progress bar (thin strips at top)
    var progressBars = document.querySelectorAll('[role="progressbar"]');
    if (progressBars.length > 0) {
      var ancestor = progressBars[0].closest('div[style*="position"]') || document.body;
      return ancestor;
    }

    return document.body;
  }

  // ── Extract author ────────────────────────────────────────────────────────

  function extractAuthor(container) {
    var name = null;
    var profileUrl = null;
    var avatarUrl = null;

    // h3 with an anchor (most common pattern in 2025 FB stories)
    var h3 = container.querySelector("h3");
    if (h3) {
      var link = h3.querySelector("a[href]");
      if (link) {
        var txt = (link.textContent || "").trim();
        if (txt.length > 1 && txt.length < 80) {
          name = txt;
          profileUrl = link.href;
        }
      }
      if (!name) {
        var raw = (h3.textContent || "").trim();
        if (raw.length > 1 && raw.length < 80) name = raw;
      }
    }

    // aria-label links as fallback
    if (!name) {
      var ariaLinks = container.querySelectorAll('a[aria-label][role="link"]');
      var skipRe = /^(Like|Comment|Share|Reply|More|See|View|Photo|Video|Haha|Wow|Sad|Angry|Love|Care|Open|Close|Play|Mute|Next|Previous|Pause|Unmute)/i;
      for (var i = 0; i < ariaLinks.length; i++) {
        var label = ariaLinks[i].getAttribute("aria-label") || "";
        if (label.length > 2 && label.length < 80 && !skipRe.test(label)) {
          name = label.trim();
          profileUrl = ariaLinks[i].href;
          break;
        }
      }
    }

    // Avatar: small image (30-80px) near the top of the container
    var imgs = container.querySelectorAll("img");
    for (var j = 0; j < Math.min(imgs.length, 10); j++) {
      var img = imgs[j];
      var w = img.width || img.naturalWidth;
      var h = img.height || img.naturalHeight;
      if (w > 25 && w < 90 && h > 25 && h < 90 && img.src) {
        avatarUrl = img.src;
        break;
      }
    }

    return { name: name, profileUrl: profileUrl, avatarUrl: avatarUrl };
  }

  // ── Extract media ─────────────────────────────────────────────────────────
  // Story media is full-bleed. Pick the largest image or the video.

  function extractMedia(container) {
    var urls = [];
    var isVideo = false;

    var video = container.querySelector("video");
    if (video) {
      isVideo = true;
      if (video.src) urls.push(video.src);
      if (video.poster) urls.push(video.poster);
      var sources = video.querySelectorAll("source");
      for (var s = 0; s < sources.length; s++) {
        if (sources[s].src) urls.push(sources[s].src);
      }
    }

    if (urls.length === 0) {
      var imgs = container.querySelectorAll(
        'img[src*="scontent"], img[src*="fbcdn"]'
      );
      var bestImg = null;
      var bestArea = 0;
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var w = img.width || img.naturalWidth || 0;
        var h = img.height || img.naturalHeight || 0;
        var area = w * h;
        if (area > bestArea) {
          bestArea = area;
          bestImg = img;
        }
      }
      if (bestImg && bestImg.src) urls.push(bestImg.src);
    }

    return { urls: urls, isVideo: isVideo };
  }

  // ── Extract timestamp ─────────────────────────────────────────────────────

  function extractTimestamp(container) {
    var timeEl = container.querySelector("time[datetime]");
    if (timeEl) return timeEl.getAttribute("datetime");

    var abbrEl = container.querySelector("abbr[data-utime]");
    if (abbrEl) {
      var ut = parseInt(abbrEl.getAttribute("data-utime"), 10);
      if (!isNaN(ut)) return new Date(ut * 1000).toISOString();
    }

    // Relative time text ("2h ago", "Just now")
    var spans = container.querySelectorAll("span");
    for (var i = 0; i < spans.length; i++) {
      var txt = (spans[i].textContent || "").trim();
      if (/^\d+[hm]$/.test(txt) || /^\d+\s+(hour|minute)s?\s+ago$/i.test(txt) || /^just now$/i.test(txt)) {
        var now = Date.now();
        var ms = 0;
        var rel = txt.match(/(\d+)([hm])/);
        if (rel) {
          var n = parseInt(rel[1], 10);
          ms = rel[2] === "h" ? n * 3600000 : n * 60000;
        }
        return new Date(now - ms).toISOString();
      }
    }

    return new Date().toISOString();
  }

  // ── Extract location / check-in ───────────────────────────────────────────
  // FB story check-ins appear as tappable overlays or text in the story header.

  function extractLocation(container) {
    // Check-in link
    var locLink = container.querySelector(
      'a[href*="/pages/"], a[href*="places"], a[href*="check_in"]'
    );
    if (locLink) {
      return { name: (locLink.textContent || "").trim() || null, url: locLink.href };
    }

    // Location sticker text (aria or data attributes)
    var stickers = container.querySelectorAll(
      '[aria-label*="location"], [aria-label*="Location"], [aria-label*="check"], [aria-label*="Check"]'
    );
    if (stickers.length > 0) {
      var txt = (stickers[0].textContent || "").trim();
      if (txt && txt.length < 120) return { name: txt, url: null };
    }

    return { name: null, url: null };
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  try {
    var rawStoryId = extractStoryId();
    var container = findStoryContainer();
    var author = extractAuthor(container);
    var media = extractMedia(container);
    var timestampIso = extractTimestamp(container);
    var location = extractLocation(container);

    var storyId = rawStoryId
      ? "fbstory_" + rawStoryId
      : "fbstory_" + (author.name || "unknown").replace(/\s+/g, "_") + "_" + Date.now();

    // Content hash for deduplication (same as fb-extract.js pattern)
    var seed = (author.name || "") + "||" + storyId;
    var hash = 0;
    for (var c = 0; c < seed.length; c++) {
      hash = (hash << 5) - hash + seed.charCodeAt(c);
      hash |= 0;
    }
    var id = "fb_" + Math.abs(hash).toString(36);

    var post = {
      id: id,
      url: window.location.href,
      authorName: author.name,
      authorProfileUrl: author.profileUrl,
      authorAvatarUrl: author.avatarUrl,
      text: null,
      timestampSeconds: null,
      timestampIso: timestampIso,
      mediaUrls: media.urls,
      hasVideo: media.isVideo,
      likeCount: null,
      commentCount: null,
      shareCount: null,
      postType: "story",
      location: location.name,
      locationUrl: location.url,
      hashtags: [],
      isShare: false,
      sharedFrom: null,
      strategy: "story-viewer",
    };

    emit("fb-feed-data", {
      posts: [post],
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: 1,
      scrollY: 0,
      feedContainerFound: false,
    });
  } catch (err) {
    emit("fb-feed-data", {
      posts: [],
      error: err.message || String(err),
      extractedAt: Date.now(),
      url: window.location.href,
    });
  }
})();
