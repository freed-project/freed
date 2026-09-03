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

  function expandLongTextControls(root) {
    var controls = root.querySelectorAll("button, a, span[role='button']");
    var clicked = 0;
    for (var i = 0; i < controls.length && clicked < 8; i++) {
      var label = (
        controls[i].getAttribute("aria-label") ||
        controls[i].textContent ||
        ""
      ).trim().toLowerCase();
      if (label === "see more" || label === "show more" || label === "...see more" || label === "read more") {
        try {
          controls[i].click();
          clicked++;
        } catch (_) {}
      }
    }
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

  function normalizeWhitespace(text) {
    return text ? text.replace(/\s+/g, " ").trim() : "";
  }

  function stableContentId(parts) {
    var value = parts.map(normalizeWhitespace).join("|").toLowerCase();
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return "urn:freed:linkedin:content:" + (hash >>> 0).toString(16).padStart(8, "0");
  }

  function authorNameFromControl(container) {
    var controls = container.querySelectorAll("button[aria-label]");
    for (var i = 0; i < controls.length; i++) {
      var label = normalizeWhitespace(controls[i].getAttribute("aria-label"));
      var match = label.match(/^open control menu for post by (.+)$/i);
      if (match) return match[1];
    }
    return null;
  }

  function profileLinkForAuthor(container, authorName) {
    var links = container.querySelectorAll("a[href*='/in/'], a[href*='/company/']");
    var normalizedAuthor = normalizeWhitespace(authorName).toLowerCase();
    for (var i = 0; i < links.length; i++) {
      var label = normalizeWhitespace(
        links[i].getAttribute("aria-label") || links[i].textContent
      ).toLowerCase();
      if (normalizedAuthor && label.indexOf(normalizedAuthor) >= 0) return links[i];
    }
    return links.length > 0 ? links[0] : null;
  }

  function semanticPostText(container) {
    var preferred = qs(container, [
      "[data-view-name='feed-commentary']",
      "[data-testid='expandable-text-box']",
      "[data-test-id='main-feed-activity-card__commentary']",
      "div[dir='ltr']",
      "p[dir='ltr']",
    ]);
    if (preferred) {
      var preferredText = normalizeWhitespace(preferred.textContent);
      if (preferredText.length >= 20) return preferredText;
    }

    var candidates = container.querySelectorAll("p, div, span");
    var best = "";
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (candidate.closest("button, nav")) continue;
      if (candidate.querySelector("h2, button")) continue;
      var text = normalizeWhitespace(candidate.textContent);
      if (text.length < 20 || text === "Feed post") continue;
      if (text.length > best.length) best = text;
    }
    return best || null;
  }

  function feedPostHeadingCount(root) {
    var headings = root.querySelectorAll("h2");
    var count = 0;
    for (var i = 0; i < headings.length; i++) {
      if (normalizeWhitespace(headings[i].textContent).toLowerCase() === "feed post") count++;
    }
    return count;
  }

  function hasPostSignals(root) {
    if (!root.querySelector("a[href*='/in/'], a[href*='/company/']")) return false;
    var controls = root.querySelectorAll("button, a, span[role='button']");
    for (var i = 0; i < controls.length; i++) {
      var label = normalizeWhitespace(
        controls[i].getAttribute("aria-label") || controls[i].textContent
      ).toLowerCase();
      if (/\b(like|comment|repost|send|reaction)s?\b/.test(label)) return true;
    }
    return false;
  }

  function findSemanticFeedPostContainers() {
    var headings = document.querySelectorAll("h2");
    var containers = [];
    for (var i = 0; i < headings.length; i++) {
      if (normalizeWhitespace(headings[i].textContent).toLowerCase() !== "feed post") continue;

      var node = headings[i];
      var best = null;
      for (var depth = 0; depth < 12 && node && node.parentElement; depth++) {
        node = node.parentElement;
        if (node === document.body || node.tagName === "MAIN") break;
        if (feedPostHeadingCount(node) !== 1) break;
        if (hasPostSignals(node)) best = node;
      }
      if (best && containers.indexOf(best) === -1) containers.push(best);
    }
    return containers;
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
    var labels = container.querySelectorAll("span, div");
    for (var j = 0; j < labels.length; j++) {
      if (normalizeWhitespace(labels[j].textContent).toLowerCase() === "promoted") return true;
    }
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
    // LinkedIn's current feed exposes a stable semantic heading for each post
    // even when the historical data-urn and BEM class names are absent.
    if (all.length === 0) all = findSemanticFeedPostContainers();
    return all;
  }

  function collectPageState(containers, posts) {
    var bodyText = (document.body && document.body.textContent ? document.body.textContent : "").toLowerCase();
    var main = document.querySelector("main, main[role='main'], #main-content");
    return {
      url: window.location.href,
      title: document.title || null,
      readyState: document.readyState,
      scrollHeight: document.documentElement ? document.documentElement.scrollHeight : null,
      bodyTextLength: bodyText.length,
      mainFound: Boolean(main),
      loginChrome: /sign in|join now|email or phone|password/.test(bodyText.slice(0, 5000)),
      loggedInCookie: document.cookie.indexOf("li_at=") >= 0,
      candidateCount: containers.length,
      extractedPostCount: posts.length,
      feedContainerCount: document.querySelectorAll(".scaffold-finite-scroll__content, main[role='main'], #main-content").length,
      dataUrnCount: document.querySelectorAll("[data-urn]").length,
      activityUrnCount: document.querySelectorAll("[data-urn*='urn:li:activity'], [data-urn*='urn:li:ugcPost'], [data-urn*='urn:li:reshare']").length,
      articleCount: document.querySelectorAll("article").length,
      semanticFeedPostHeadingCount: Array.from(document.querySelectorAll("h2")).filter(function (heading) {
        return normalizeWhitespace(heading.textContent).toLowerCase() === "feed post";
      }).length,
    };
  }

  // ---------------------------------------------------------------------------
  // Extract a single post
  // ---------------------------------------------------------------------------

  function extractPost(container) {
    expandLongTextControls(container);

    // URN / ID
    var urnNode = container.matches("[data-urn]") ? container : container.querySelector("[data-urn]");
    var urn = urnNode ? (urnNode.getAttribute("data-urn") || null) : null;

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

    // Sponsored check
    if (isSponsored(container)) return null;

    // ── Author ──────────────────────────────────────────────────────────────
    var authorName = getText(container, [
      ".update-components-actor__name span[aria-hidden='true']",
      ".update-components-actor__name",
      ".feed-shared-actor__name",
    ]);

    var controlledAuthorName = authorNameFromControl(container);
    if (controlledAuthorName) authorName = controlledAuthorName;
    var semanticProfileLink = profileLinkForAuthor(container, authorName);
    if (!authorName && semanticProfileLink) {
      authorName = normalizeWhitespace(semanticProfileLink.textContent);
      if (!authorName) {
        var profileLabel = normalizeWhitespace(semanticProfileLink.getAttribute("aria-label"));
        var profileMatch = profileLabel.match(/^view\s+(.+?)(?:'s|’s)\s+profile$/i);
        authorName = profileMatch ? profileMatch[1] : profileLabel;
      }
    }

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
    if (!authorProfileUrl && semanticProfileLink) authorProfileUrl = semanticProfileLink.href || null;

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
    var text = textNode ? textNode.textContent.trim() : null;
    if (!text) text = semanticPostText(container);

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

    if (!timestampRelative) {
      var relativeText = normalizeWhitespace(container.textContent);
      var relativeMatch = relativeText.match(/\b\d+\s*(?:s|m|h|d|w|mo|yr)\b/i);
      if (relativeMatch) timestampRelative = relativeMatch[0];
    }

    if (!urn && !url && text) {
      urn = stableContentId([
        authorProfileUrl || authorName || "unknown",
        text,
      ]);
    }

    if (!urn && !url) return null;

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
    if (reactionCount === null) {
      var reactionControl = container.querySelector("[aria-label*=' reaction'], [aria-label$=' reactions']");
      if (reactionControl) {
        var reactionMatch = normalizeWhitespace(reactionControl.getAttribute("aria-label") || reactionControl.textContent).match(/[\d,.]+\s*[km]?/i);
        if (reactionMatch) reactionCount = parseEngagementCount(reactionMatch[0]);
      }
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
    if (commentCount === null) {
      var semanticComment = container.querySelector("[aria-label*=' comment'], [aria-label$=' comments']");
      if (semanticComment) {
        var commentMatch = normalizeWhitespace(semanticComment.getAttribute("aria-label") || semanticComment.textContent).match(/[\d,.]+\s*[km]?/i);
        if (commentMatch) commentCount = parseEngagementCount(commentMatch[0]);
      }
    }

    var repostCount = null;
    var repostLinks = container.querySelectorAll(".social-details-social-counts__reshares a");
    if (repostLinks.length > 0) {
      repostCount = parseEngagementCount(repostLinks[0].textContent);
    }
    if (repostCount === null) {
      var semanticRepost = container.querySelector("[aria-label*=' repost'], [aria-label$=' reposts']");
      if (semanticRepost) {
        var repostMatch = normalizeWhitespace(semanticRepost.getAttribute("aria-label") || semanticRepost.textContent).match(/[\d,.]+\s*[km]?/i);
        if (repostMatch) repostCount = parseEngagementCount(repostMatch[0]);
      }
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
        pageState: collectPageState(containers, posts),
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
        pageState: collectPageState([], []),
        scrollY: window.scrollY,
      });
    }
  }
})();
