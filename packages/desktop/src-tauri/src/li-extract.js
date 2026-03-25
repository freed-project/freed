/**
 * LinkedIn feed extraction script
 *
 * Injected into the LinkedIn WebView after page load. Reads posts from
 * the rendered DOM and emits them via Tauri event IPC ('li-feed-data').
 *
 * LinkedIn uses data-urn attributes on post containers and relatively
 * stable BEM-style class names (feed-shared-update-v2, update-components-*).
 * We extract by urn to get stable IDs.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function qs(el, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var found = el.querySelector(selectors[i]);
        if (found) return found;
      } catch (_) {}
    }
    return null;
  }

  function qsa(el, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var found = el.querySelectorAll(selectors[i]);
        if (found && found.length > 0) return Array.from(found);
      } catch (_) {}
    }
    return [];
  }

  function getText(el, selectors) {
    var node = qs(el, selectors);
    return node ? node.textContent.trim() : null;
  }

  function getAttr(el, selectors, attr) {
    var node = qs(el, selectors);
    return node ? (node.getAttribute(attr) || null) : null;
  }

  function parseEngagementCount(text) {
    if (!text) return null;
    var clean = text.trim().replace(/,/g, "");
    if (!clean) return null;
    var lower = clean.toLowerCase();
    var m = lower.match(/^([\d.]+)\s*([km]?)$/);
    if (!m) return null;
    var num = parseFloat(m[1]);
    if (isNaN(num)) return null;
    if (m[2] === "k") return Math.round(num * 1000);
    if (m[2] === "m") return Math.round(num * 1000000);
    return Math.round(num);
  }

  function extractHashtags(text) {
    if (!text) return [];
    var matches = text.match(/#[a-zA-Z][a-zA-Z0-9_]*/g) || [];
    var seen = {};
    return matches
      .map(function (h) { return h.toLowerCase(); })
      .filter(function (h) {
        if (seen[h]) return false;
        seen[h] = true;
        return true;
      });
  }

  function extractProfileHandle(url) {
    if (!url) return "unknown";
    try {
      var u = new URL(url);
      var parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && (parts[0] === "in" || parts[0] === "company")) {
        return parts[1];
      }
      if (parts.length >= 1) return parts[parts.length - 1];
    } catch (_) {}
    return "unknown";
  }

  // ---------------------------------------------------------------------------
  // Sponsored post detection
  // ---------------------------------------------------------------------------

  function isSponsored(container) {
    var sponsorSelectors = [
      ".update-components-actor__badge",
      "li-icon[type='promoted-flag-icon']",
    ];
    for (var i = 0; i < sponsorSelectors.length; i++) {
      if (container.querySelector(sponsorSelectors[i])) return true;
    }
    // Text-based check: "Promoted" in actor sub-description
    var subDesc = container.querySelector(".update-components-actor__sub-description");
    if (subDesc && /promoted/i.test(subDesc.textContent)) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Find feed posts
  // ---------------------------------------------------------------------------

  function findPostContainers() {
    // Primary: find all elements with data-urn pointing to feed content
    var urnSelectors = [
      "div[data-urn*='urn:li:activity']",
      "div[data-urn*='urn:li:ugcPost']",
      "div[data-urn*='urn:li:reshare']",
    ];
    var all = [];
    var seen = new Set();
    for (var i = 0; i < urnSelectors.length; i++) {
      var nodes = document.querySelectorAll(urnSelectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        var urn = n.getAttribute("data-urn");
        if (urn && !seen.has(urn)) {
          seen.add(urn);
          all.push(n);
        }
      }
    }
    // Fallback: feed-shared-update-v2 class
    if (all.length === 0) {
      var fallback = document.querySelectorAll(".feed-shared-update-v2");
      all = Array.from(fallback);
    }
    return all;
  }

  // ---------------------------------------------------------------------------
  // Extract a single post
  // ---------------------------------------------------------------------------

  function extractPost(container) {
    // URN / ID
    var urn = container.getAttribute("data-urn") || null;

    // Post URL — try to derive from URN or find a share link
    var url = null;
    if (urn) {
      // urn:li:activity:1234567890 → https://www.linkedin.com/feed/update/urn:li:activity:1234567890/
      url = "https://www.linkedin.com/feed/update/" + encodeURIComponent(urn) + "/";
    } else {
      // Try to find a "View post" or share link
      var shareLink = container.querySelector("a[href*='/feed/update/']");
      if (shareLink) url = shareLink.href;
    }

    if (!urn && !url) return null;

    // Sponsored check
    if (isSponsored(container)) return null;

    // ── Author ──────────────────────────────────────────────────────────────
    var authorName = getText(container, [
      ".update-components-actor__name span[aria-hidden='true']",
      ".update-components-actor__name",
      ".feed-shared-actor__name",
    ]);

    var authorHeadline = getText(container, [
      ".update-components-actor__description span[aria-hidden='true']",
      ".update-components-actor__description",
      ".feed-shared-actor__description",
    ]);

    var authorProfileUrl = getAttr(container, [
      ".update-components-actor__container a.app-aware-link",
      ".update-components-actor__container a[href*='/in/']",
      ".feed-shared-actor__container-link",
    ], "href");

    // Normalize LinkedIn profile URL (strip tracking params)
    if (authorProfileUrl) {
      try {
        var u = new URL(authorProfileUrl);
        authorProfileUrl = u.origin + u.pathname;
      } catch (_) {}
    }

    var authorAvatarUrl = getAttr(container, [
      ".update-components-actor__avatar img",
      ".feed-shared-actor__avatar img",
    ], "src");

    // ── Text ────────────────────────────────────────────────────────────────
    var textNode = qs(container, [
      ".feed-shared-update-v2__description .feed-shared-text",
      ".update-components-text .feed-shared-text",
      ".feed-shared-update-v2__description",
      ".update-components-text",
    ]);
    var text = textNode ? textNode.innerText.trim() : null;

    // ── Timestamp ────────────────────────────────────────────────────────────
    var timestampIso = null;
    var timestampRelative = null;
    var timeEl = container.querySelector("time[datetime]");
    if (timeEl) {
      timestampIso = timeEl.getAttribute("datetime") || null;
    }
    // Relative timestamp from sub-description
    var subDesc = container.querySelector(
      ".update-components-actor__sub-description span[aria-hidden='true']"
    );
    if (!subDesc) {
      subDesc = container.querySelector(".feed-shared-actor__sub-description span[aria-hidden='true']");
    }
    if (subDesc) {
      var subText = subDesc.textContent.trim();
      // Relative time usually appears first, separated by bullet "•"
      var relMatch = subText.split(/\s*[•·]\s*/)[0].trim();
      if (/^\d+\s*(s|m|h|d|w|mo|yr)/.test(relMatch)) {
        timestampRelative = relMatch;
      }
    }

    // ── Media ────────────────────────────────────────────────────────────────
    var mediaUrls = [];
    var hasVideo = false;

    var images = qsa(container, [
      "img.update-components-image__image",
      "img.feed-shared-image__image",
      ".feed-shared-update-v2__content img[src*='media.licdn.com']",
    ]);
    images.forEach(function (img) {
      var src = img.src || img.getAttribute("src");
      if (src && src.indexOf("data:") !== 0 && mediaUrls.indexOf(src) === -1) {
        mediaUrls.push(src);
      }
    });

    var videoEl = container.querySelector("video");
    if (videoEl) {
      hasVideo = true;
      var vsrc = videoEl.src || videoEl.getAttribute("src");
      if (vsrc && mediaUrls.indexOf(vsrc) === -1) {
        mediaUrls.unshift(vsrc);
      }
    }

    // ── Article / link preview ───────────────────────────────────────────────
    var articleUrl = null;
    var articleTitle = null;
    var articleLinkEl = qs(container, [
      ".feed-shared-article__link",
      ".update-components-article__link",
      "a.app-aware-link[href*='linkedin.com/pulse']",
      "a.app-aware-link[href*='linkedin.com/news']",
    ]);
    if (articleLinkEl) {
      articleUrl = articleLinkEl.href || null;
    }
    var articleTitleEl = qs(container, [
      ".feed-shared-article__title",
      ".update-components-article__title",
    ]);
    if (articleTitleEl) {
      articleTitle = articleTitleEl.textContent.trim() || null;
    }

    // ── Engagement ───────────────────────────────────────────────────────────
    var reactionCount = null;
    var reactionEl = container.querySelector(".social-details-social-counts__reactions-count");
    if (!reactionEl) {
      reactionEl = container.querySelector(".social-details-social-counts__count-value");
    }
    if (reactionEl) {
      reactionCount = parseEngagementCount(reactionEl.textContent);
    }

    var commentCount = null;
    var commentLinks = container.querySelectorAll(".social-details-social-counts__comments a");
    if (commentLinks.length > 0) {
      commentCount = parseEngagementCount(commentLinks[0].textContent);
    } else {
      var commentBtn = container.querySelector("button[aria-label*='comment']");
      if (commentBtn) {
        var countSpan = commentBtn.querySelector(".social-details-social-counts__social-proof-text");
        if (countSpan) commentCount = parseEngagementCount(countSpan.textContent);
      }
    }

    var repostCount = null;
    var repostLinks = container.querySelectorAll(".social-details-social-counts__reshares a");
    if (repostLinks.length > 0) {
      repostCount = parseEngagementCount(repostLinks[0].textContent);
    }

    // ── Hashtags ─────────────────────────────────────────────────────────────
    var hashtags = extractHashtags(text);

    // ── Repost detection ─────────────────────────────────────────────────────
    var isRepost = false;
    var repostedFrom = null;
    var repostContainer = container.querySelector(".feed-shared-mini-update-v2, .update-components-mini-update-v2");
    if (repostContainer) {
      isRepost = true;
      var origAuthorEl = qs(repostContainer, [
        ".update-components-actor__name span[aria-hidden='true']",
        ".update-components-actor__name",
        ".feed-shared-actor__name",
      ]);
      var origLinkEl = qs(repostContainer, [
        ".update-components-actor__container a.app-aware-link",
        ".feed-shared-actor__container-link",
      ]);
      if (origAuthorEl || origLinkEl) {
        repostedFrom = {
          name: origAuthorEl ? origAuthorEl.textContent.trim() : "",
          url: origLinkEl ? origLinkEl.href : "",
        };
      }
    }

    // ── Post type ────────────────────────────────────────────────────────────
    var postType = "post";
    if (articleUrl) postType = "article";
    else if (isRepost) postType = "shared";
    else if (container.querySelector(".feed-shared-poll")) postType = "poll";
    else if (container.querySelector(".feed-shared-event")) postType = "event";
    else if (hasVideo) postType = "post"; // video post

    return {
      urn: urn,
      url: url,
      authorName: authorName,
      authorHeadline: authorHeadline,
      authorProfileUrl: authorProfileUrl,
      authorAvatarUrl: authorAvatarUrl,
      text: text,
      timestampIso: timestampIso,
      timestampRelative: timestampRelative,
      mediaUrls: mediaUrls,
      hasVideo: hasVideo,
      articleUrl: articleUrl,
      articleTitle: articleTitle,
      reactionCount: reactionCount,
      commentCount: commentCount,
      repostCount: repostCount,
      hashtags: hashtags,
      isRepost: isRepost,
      repostedFrom: repostedFrom,
      postType: postType,
    };
  }

  // ---------------------------------------------------------------------------
  // Main extraction
  // ---------------------------------------------------------------------------

  try {
    var containers = findPostContainers();
    var posts = [];

    for (var i = 0; i < containers.length; i++) {
      try {
        var post = extractPost(containers[i]);
        if (post) posts.push(post);
      } catch (_) {}
    }

    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
      window.__TAURI__.event.emit("li-feed-data", {
        posts: posts,
        extractedAt: Date.now(),
        url: window.location.href,
        candidateCount: containers.length,
        scrollY: window.scrollY,
      });
    }
  } catch (err) {
    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
      window.__TAURI__.event.emit("li-feed-data", {
        posts: [],
        error: err && err.message ? err.message : String(err),
        extractedAt: Date.now(),
        url: window.location.href,
        candidateCount: 0,
        scrollY: window.scrollY,
      });
    }
  }
})();
