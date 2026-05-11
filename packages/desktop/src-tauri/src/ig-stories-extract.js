// Instagram story viewer extraction script.
// Injected by the Rust story navigation loop immediately after each story frame
// becomes visible. Extracts author, media, timestamp, location sticker, and
// story ID from the full-screen story overlay, then emits via ig-feed-data so
// the existing TypeScript accumulator treats stories identically to feed posts.
//
// Instagram story viewer DOM (2025-2026):
//   - Full-screen overlay div (role="presentation" or aria-label containing "Story")
//   - Author section at the top: avatar img + username anchor
//   - Media: single img or video element filling the frame
//   - Location sticker: an anchor linking to /explore/locations/ or a div
//     with a location pin icon and text
//   - Story ID embedded in the URL: /stories/<username>/<storyId>/
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

  function contentHash(a, b) {
    var seed = (a || "") + "||" + (b || "");
    var hash = 0;
    for (var i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function isLikelyEphemeralStoryId(storyId) {
    return /^\d{13}$/.test(storyId || "");
  }

  function extractStoryId() {
    var href = window.location.href;
    var m = href.match(/\/stories\/([^/?#]+)(?:\/([^/?#]+))?/);
    if (m) {
      return {
        username: decodeURIComponent(m[1]),
        storyId: m[2] && !isLikelyEphemeralStoryId(m[2]) ? decodeURIComponent(m[2]) : null,
      };
    }
    return { username: null, storyId: null };
  }

  function isStoryUrl(urlInfo) {
    return !!(urlInfo && urlInfo.username);
  }

  function hasStoryControls(container) {
    return !!(
      container.querySelector('[aria-label*="Next"], [aria-label*="next"]') ||
      container.querySelector('[aria-label*="Close"], [aria-label*="close"]') ||
      container.querySelector('[role="progressbar"]') ||
      container.querySelector('a[href*="/stories/"]')
    );
  }

  function hasStoryMedia(container) {
    return !!(
      container.querySelector("video") ||
      container.querySelector('img[src*="cdninstagram"], img[src*="scontent"], img[srcset]')
    );
  }

  function findStoryContainer(urlInfo) {
    var onStoryUrl = isStoryUrl(urlInfo);
    var dialog = document.querySelector('[role="dialog"]');
    if (
      dialog &&
      dialog.offsetHeight > 400 &&
      hasStoryMedia(dialog) &&
      (onStoryUrl || hasStoryControls(dialog))
    ) {
      return dialog;
    }

    var fullBleed = document.querySelector(
      'div[style*="position: fixed"], div[style*="position:fixed"]'
    );
    if (
      fullBleed &&
      fullBleed.offsetHeight > window.innerHeight * 0.8 &&
      hasStoryMedia(fullBleed) &&
      (onStoryUrl || hasStoryControls(fullBleed))
    ) {
      return fullBleed;
    }

    var sections = document.querySelectorAll("section");
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (
        s.offsetHeight > 400 &&
        hasStoryMedia(s) &&
        (onStoryUrl || hasStoryControls(s))
      ) {
        return s;
      }
    }

    return null;
  }

  var IG_USERNAME_RE = /instagram\.com\/([A-Za-z0-9_.]+)\/?(?:\?|$|#)/;
  var IG_SKIP_PATHS = /^(p|reel|reels|stories|explore|accounts|direct|tv|ar|challenge|audio|location|locations|tags|instagram)$/i;

  function isGenericHandle(handle) {
    return !handle || IG_SKIP_PATHS.test(handle);
  }

  function extractAuthor(container, urlInfo) {
    var handle = null;
    var displayName = null;
    var avatarUrl = null;
    var profileUrl = null;

    if (urlInfo.username && !isGenericHandle(urlInfo.username)) {
      handle = urlInfo.username;
      displayName = urlInfo.username;
      profileUrl = "https://www.instagram.com/" + urlInfo.username + "/";
    }

    var allLinks = container.querySelectorAll("a[href]");
    for (var i = 0; i < allLinks.length; i++) {
      var link = allLinks[i];
      var href = link.href || "";
      var m = href.match(IG_USERNAME_RE);
      if (m && !isGenericHandle(m[1])) {
        if (handle && m[1] !== handle) continue;
        handle = m[1];
        profileUrl = href;
        var linkText = (link.textContent || "").trim();
        if (linkText && linkText.length > 0 && linkText.length < 80) {
          displayName = linkText;
        }
        break;
      }
    }

    var imgs = container.querySelectorAll("img");
    for (var j = 0; j < Math.min(imgs.length, 10); j++) {
      var img = imgs[j];
      var w = img.width || img.naturalWidth;
      var h = img.height || img.naturalHeight;
      // Avatar images are 30-80px — story media is full-bleed (much larger)
      if (w > 20 && w < 90 && h > 20 && h < 90 && img.src) {
        avatarUrl = img.src;
        break;
      }
    }

    return {
      handle: handle,
      displayName: displayName || handle,
      avatarUrl: avatarUrl,
      profileUrl: profileUrl || (handle ? "https://www.instagram.com/" + handle + "/" : null),
    };
  }

  // ── Extract media URL ─────────────────────────────────────────────────────
  // Story media is a single full-bleed image or video. We want the largest
  // img or the video's src/poster.

  function extractMedia(container) {
    var urls = [];
    var types = [];
    var isVideo = false;

    // Video story
    var video = container.querySelector("video");
    if (video) {
      isVideo = true;
      var videoUrl = video.currentSrc || video.src;
      if (videoUrl && /^https?:\/\//i.test(videoUrl)) {
        urls.push(videoUrl);
        types.push("video");
      }
      if (video.poster) {
        urls.push(video.poster);
        types.push("image");
      }
      // <source> tags
      var sources = video.querySelectorAll("source");
      for (var s = 0; s < sources.length; s++) {
        if (sources[s].src && /^https?:\/\//i.test(sources[s].src)) {
          urls.push(sources[s].src);
          types.push("video");
        }
      }
    }

    // Image story — find the largest image (story media, not avatar)
    if (urls.length === 0) {
      var imgs = container.querySelectorAll(
        'img[src*="cdninstagram"], img[src*="scontent"], img[srcset]'
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
      if (bestImg && bestImg.src) {
        urls.push(bestImg.src);
        types.push("image");
      }
    }

    return { urls: urls, types: types, isVideo: isVideo };
  }

  // ── Extract timestamp ─────────────────────────────────────────────────────
  // Stories show relative time ("2h", "3m") in the header strip.

  function extractTimestamp(container) {
    var timeEl = container.querySelector("time[datetime]");
    if (timeEl) return timeEl.getAttribute("datetime");

    // Relative time text near the author area (e.g., "2 hours ago", "3m")
    var spans = container.querySelectorAll("span, time");
    for (var i = 0; i < spans.length; i++) {
      var txt = (spans[i].textContent || "").trim();
      if (/^\d+[hms]$/.test(txt) || /^\d+\s*(hour|minute|second)s?\s*ago$/i.test(txt)) {
        // Return a rough ISO based on now - offset
        var now = Date.now();
        var ms = 0;
        var rel = txt.match(/(\d+)([hms])/);
        if (rel) {
          var n = parseInt(rel[1], 10);
          if (rel[2] === "h") ms = n * 3600000;
          else if (rel[2] === "m") ms = n * 60000;
          else if (rel[2] === "s") ms = n * 1000;
        }
        return new Date(now - ms).toISOString();
      }
    }

    return new Date().toISOString();
  }

  // ── Extract location sticker ──────────────────────────────────────────────
  // Location stickers on IG stories are anchors to /explore/locations/<id>/
  // or text overlays on the story canvas.

  function extractLocation(container) {
    var locLink = container.querySelector('a[href*="/explore/locations/"]');
    if (locLink) {
      return {
        name: (locLink.textContent || "").trim() || null,
        url: locLink.href || null,
      };
    }

    // Sometimes the location is a styled div (tappable sticker) without a link.
    // Look for elements with aria-label containing "location" text.
    var stickers = container.querySelectorAll('[aria-label*="location"], [aria-label*="Location"]');
    if (stickers.length > 0) {
      return {
        name: (stickers[0].textContent || "").trim() || null,
        url: null,
      };
    }

    return { name: null, url: null };
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  try {
    var urlInfo = extractStoryId();
    var container = findStoryContainer(urlInfo);
    if (!container) {
      emit("ig-feed-data", {
        posts: [],
        extractedAt: Date.now(),
        url: window.location.href,
        candidateCount: 0,
        scrollY: 0,
        strategy: "story-viewer-skip",
      });
      return;
    }

    var author = extractAuthor(container, urlInfo);
    var media = extractMedia(container);
    if (isGenericHandle(author.handle) || media.urls.length === 0) {
      emit("ig-feed-data", {
        posts: [],
        extractedAt: Date.now(),
        url: window.location.href,
        candidateCount: 0,
        scrollY: 0,
        strategy: "story-viewer-skip",
      });
      return;
    }

    var timestampIso = extractTimestamp(container);
    var location = extractLocation(container);

    // Build a stable ID: story-<storyId> or a hash of author+timestamp
    var stableSeed = [
      media.urls[0] || "",
      location.url || "",
      location.name || "",
      timestampIso || "",
    ].join("||");
    var storyId = urlInfo.storyId
      ? "story_" + urlInfo.storyId
      : "story_" + contentHash(author.handle || "unknown", stableSeed || window.location.pathname);

    var post = {
      shortcode: storyId,
      url: window.location.href,
      authorHandle: author.handle,
      authorDisplayName: author.displayName,
      authorAvatarUrl: author.avatarUrl,
      authorProfileUrl: author.profileUrl,
      caption: null,
      timestampIso: timestampIso,
      mediaUrls: media.urls,
      mediaTypes: media.types,
      isVideo: media.isVideo,
      isCarousel: false,
      likeCount: null,
      commentCount: null,
      hashtags: [],
      location: location.name,
      locationUrl: location.url,
      postType: "story",
    };

    emit("ig-feed-data", {
      posts: [post],
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: 1,
      scrollY: 0,
      strategy: "story-viewer",
    });
  } catch (err) {
    emit("ig-feed-data", {
      posts: [],
      error: err.message || String(err),
      extractedAt: Date.now(),
      url: window.location.href,
      strategy: "story-viewer-error",
    });
  }
})();
