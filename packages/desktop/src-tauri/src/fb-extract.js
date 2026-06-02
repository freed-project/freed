// Self-contained extraction script injected into the Facebook WebView.
// Facebook 2025-2026: the feed is deeply nested, heavily virtualized,
// and uses almost no stable semantic attributes. This script locates
// the "Feed posts" section by h3 text, then walks into its subtree to
// find individual post-sized blocks.
//
// Called at multiple scroll positions; each invocation extracts whatever
// is currently visible. The Rust side accumulates and deduplicates.
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
  var scrapeRunId =
    typeof window.__FREED_FB_SCRAPE_RUN_ID === "string"
      ? window.__FREED_FB_SCRAPE_RUN_ID
      : null;

  function textValue(node, maxChars) {
    var value = node && node.textContent ? node.textContent : "";
    if (maxChars && value.length > maxChars) value = value.slice(0, maxChars);
    return value.trim();
  }

  function elementHeight(node) {
    if (!node) return 0;
    var h = node.offsetHeight || 0;
    if (h > 0) return h;
    if (typeof node.getBoundingClientRect === "function") {
      try {
        h = node.getBoundingClientRect().height || 0;
        if (h > 0) return h;
      } catch (_) {}
    }
    var testHeight = parseInt(node.getAttribute && node.getAttribute("data-freed-test-height"), 10);
    return isNaN(testHeight) ? 0 : testHeight;
  }

  function parseEngagement(text) {
    if (!text) return null;
    var cleaned = text.replace(/[^0-9.KMkm]/g, "").trim();
    if (!cleaned) return null;
    var num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    if (/[Kk]/.test(cleaned)) return Math.round(num * 1000);
    if (/[Mm]/.test(cleaned)) return Math.round(num * 1000000);
    return Math.round(num);
  }

  var FACEBOOK_UI_LABELS = new Set([
    "account",
    "ads manager",
    "create new account",
    "events",
    "facebook",
    "feeds",
    "friends",
    "gaming",
    "groups",
    "home",
    "log in",
    "marketplace",
    "memories",
    "menu",
    "messenger",
    "meta",
    "notifications",
    "pages",
    "profile",
    "reels",
    "saved",
    "search facebook",
    "see less",
    "see more",
    "sign up",
    "video",
    "watch",
    "your shortcuts",
  ]);

  var FACEBOOK_BLOCKED_PATHS = new Set([
    "ads",
    "bookmarks",
    "events",
    "friends",
    "gaming",
    "groups",
    "help",
    "home",
    "login",
    "marketplace",
    "me",
    "memories",
    "messages",
    "notifications",
    "pages",
    "privacy",
    "recover",
    "reg",
    "reel",
    "reels",
    "saved",
    "settings",
    "stories",
    "watch",
  ]);

  function normalizeLabel(value) {
    return (value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isFacebookUiChromeLabel(value) {
    var normalized = normalizeLabel(value);
    if (!normalized) return true;
    if (FACEBOOK_UI_LABELS.has(normalized)) return true;
    if (/^(create|log in|sign up|search|switch|manage)\b/.test(normalized)) return true;
    if (/\b(shortcuts|notifications|messenger|marketplace)\b/.test(normalized)) return true;
    return false;
  }

  function isValidFacebookActorUrl(value) {
    if (!value) return false;
    try {
      var url = new URL(value, "https://www.facebook.com/");
      var host = url.hostname.toLowerCase();
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return false;

      var parts = url.pathname.split("/").filter(Boolean);
      var first = parts[0] ? parts[0].toLowerCase() : "";
      if (!first || FACEBOOK_BLOCKED_PATHS.has(first)) return false;

      if (first === "profile.php") {
        return /^\d+$/.test(url.searchParams.get("id") || "");
      }

      return /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(parts[0]);
    } catch (_) {
      return false;
    }
  }

  function isValidFacebookAuthor(name, profileUrl) {
    return !isFacebookUiChromeLabel(name) && isValidFacebookActorUrl(profileUrl);
  }

  function extractHashtags(text) {
    return (text.match(/#(\w+)/g) || []).map(function (h) {
      return h.slice(1).toLowerCase();
    });
  }

  function expandLongTextControls(root) {
    var controls = root.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]');
    var clicked = 0;
    for (var i = 0; i < controls.length && clicked < 8; i++) {
      var label = (
        controls[i].getAttribute("aria-label") ||
        controls[i].textContent ||
        ""
      ).trim().toLowerCase();
      if (label === "see more" || label === "more" || label === "show more" || label === "read more") {
        try {
          controls[i].click();
          clicked++;
        } catch (_) {}
      }
    }
  }

  // Generate a content-based ID for deduplication across scroll passes
  function contentHash(author, text) {
    var seed = (author || "") + "||" + (text || "").substring(0, 120);
    var hash = 0;
    for (var c = 0; c < seed.length; c++) {
      hash = (hash << 5) - hash + seed.charCodeAt(c);
      hash |= 0;
    }
    return "fb_" + Math.abs(hash).toString(36);
  }

  // ── Locate the feed container ────────────────────────────────────────────
  // Facebook wraps the main news feed in a section headed by an h3
  // with text "Feed posts". The actual posts live inside a sibling div.

  function findFeedContainer() {
    var h3s = document.querySelectorAll("h3");
    for (var i = 0; i < h3s.length; i++) {
      var txt = (h3s[i].textContent || "").trim();
      if (txt === "Feed posts") {
        // The feed container is a sibling of this h3 inside the same parent
        var parent = h3s[i].parentElement;
        if (!parent) continue;
        var siblings = parent.children;
        for (var s = 0; s < siblings.length; s++) {
          if (siblings[s] !== h3s[i] && siblings[s].offsetHeight > 100) {
            return siblings[s];
          }
        }
      }
    }
    return null;
  }

  function classifyPageState(feedContainer) {
    var url = String(window.location && window.location.href ? window.location.href : "");
    var title = String(document.title || "");
    var cookie = String(document.cookie || "");
    var bodyText = textValue(document.body, 2000).toLowerCase();
    var scrollHeight =
      (document.documentElement && document.documentElement.scrollHeight) ||
      (document.body && document.body.scrollHeight) ||
      0;
    var loggedInCookie = cookie.indexOf("c_user=") !== -1 && cookie.indexOf("c_user=0") === -1;
    var loginUrl = /\/login\b|\/recover\b|\/reg\b/.test(url);
    var loginChrome =
      /\blog in\b/.test(bodyText) ||
      /\bsign up\b/.test(bodyText) ||
      /\bcreate new account\b/.test(bodyText);
    var shortPage = scrollHeight > 0 && scrollHeight < 1600;
    var feedUnitCount = document.querySelectorAll(
      '[role="article"], div[data-pagelet^="FeedUnit"], div[aria-posinset]'
    ).length;
    var feedLike =
      !!feedContainer ||
      loggedInCookie ||
      feedUnitCount > 0;

    if (!feedLike && (!loggedInCookie || loginUrl || (shortPage && loginChrome))) {
      return {
        state: "not_authenticated",
        message: "Facebook did not render an authenticated feed. Reconnect Facebook and try again.",
        loggedInCookie: loggedInCookie,
        feedLike: !!feedLike,
        feedUnitCount: feedUnitCount,
        loginChrome: loginChrome,
        scrollHeight: scrollHeight,
        url: url,
        title: title,
      };
    }

    if (!feedContainer && shortPage) {
      return {
        state: "short_non_feed",
        message: "Facebook rendered a short page instead of the feed. Open Facebook settings, reconnect if needed, then sync again.",
        loggedInCookie: loggedInCookie,
        feedLike: !!feedLike,
        feedUnitCount: feedUnitCount,
        loginChrome: loginChrome,
        scrollHeight: scrollHeight,
        url: url,
        title: title,
      };
    }

    return {
      state: "feed_possible",
      message: null,
      loggedInCookie: loggedInCookie,
      feedLike: !!feedLike,
      feedUnitCount: feedUnitCount,
      loginChrome: loginChrome,
      scrollHeight: scrollHeight,
      url: url,
      title: title,
    };
  }

  // ── Find individual post elements within a container ─────────────────────
  // Posts are rendered as large blocks (typically 200-1500px tall) with
  // user content. We walk the tree looking for "post-like" nodes:
  // a div that contains at least some text and/or images, and is a
  // reasonable height for a post.

  function hasPostContent(node) {
    var nodeText = textValue(node, 4000);
    var hasScontent =
      node.querySelector('img[src*="scontent"], img[src*="fbcdn"]') !== null;
    var hasVideo = node.querySelector("video") !== null;
    return nodeText.length > 40 || hasScontent || hasVideo;
  }

  function hasAuthorArea(node) {
    return (
      node.querySelector("h3 a, h4 a") !== null ||
      node.querySelector('a[aria-label][role="link"]') !== null ||
      node.querySelector('a[aria-label][href]') !== null ||
      node.querySelector('a[href*="facebook.com/profile.php"], a[href^="/profile.php"]') !== null
    );
  }

  function hasTimestampCue(node) {
    if (node.querySelector("time[datetime], abbr[data-utime]")) return true;
    var links = node.querySelectorAll("a[href], a[aria-label]");
    for (var i = 0; i < Math.min(links.length, 20); i++) {
      var text = (
        links[i].textContent ||
        links[i].getAttribute("aria-label") ||
        ""
      ).trim();
      if (
        /^\d+\s*[hms]$/i.test(text) ||
        /^\d+\s*(hour|minute|second|day|week|month)s?\s*ago$/i.test(text) ||
        /^(yesterday|today|just now)$/i.test(text) ||
        /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i.test(text)
      ) {
        return true;
      }
    }
    return false;
  }

  function isLikelyPostElement(node, container) {
    if (!node || node === container) return false;
    var h = elementHeight(node);
    var role = (node.getAttribute("role") || "").toLowerCase();
    var pagelet = node.getAttribute("data-pagelet") || "";
    var semanticPost =
      role === "article" ||
      /^FeedUnit/i.test(pagelet) ||
      node.hasAttribute("aria-posinset");
    var structurallyPost = semanticPost || (hasAuthorArea(node) && hasTimestampCue(node));

    if (!structurallyPost && (h < 150 || h > 2000)) return false;
    if (structurallyPost && h > 0 && h > 2600) return false;
    if (!hasPostContent(node)) return false;
    return structurallyPost;
  }

  function uniquePostElements(elements) {
    var unique = [];
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el) continue;
      var alreadyNested = false;
      for (var j = 0; j < unique.length; j++) {
        if (unique[j].contains(el) && unique[j] !== el) {
          alreadyNested = true;
          break;
        }
        if (el.contains(unique[j]) && unique[j] !== el) {
          unique.splice(j, 1);
          j--;
        }
      }
      if (!alreadyNested) unique.push(el);
    }
    return unique;
  }

  function findPostsInContainer(container) {
    var posts = [];
    var seen = new Set();

    var semanticCandidates = container.querySelectorAll(
      [
        '[role="article"]',
        'div[data-pagelet^="FeedUnit"]',
        'div[data-pagelet*="FeedUnit"]',
        'div[aria-posinset]',
        '[data-ft*="top_level_post_id"]',
        '[data-testid="story-subtitle"]',
      ].join(",")
    );
    for (var s = 0; s < semanticCandidates.length && posts.length < 50; s++) {
      var candidate = semanticCandidates[s];
      if (isLikelyPostElement(candidate, container)) {
        posts.push(candidate);
        continue;
      }

      var ancestor = candidate.parentElement;
      var depth = 0;
      while (ancestor && ancestor !== container && depth < 8) {
        if (isLikelyPostElement(ancestor, container)) {
          posts.push(ancestor);
          break;
        }
        ancestor = ancestor.parentElement;
        depth++;
      }
    }

    if (posts.length > 0) {
      return uniquePostElements(posts);
    }

    // Recursive walker: find leaf-ish content blocks
    function walk(node, depth) {
      if (depth > 20 || posts.length > 50) return;
      if (!node || node.nodeType !== 1) return;

      var h = elementHeight(node);
      var children = node.children || [];
      var cc = children.length;

      // A post candidate must be:
      // - Tall enough (> 150px) to be a real post, not a header
      // - Contain some text or images
      // - NOT be the entire feed container itself
      if (isLikelyPostElement(node, container)) {
        var nodeText = textValue(node, 4000);
        var id =
          node.offsetTop + ":" + h + ":" + nodeText.length;
        if (!seen.has(id)) {
          seen.add(id);
          posts.push(node);
          return; // Don't recurse into found posts
        }
      }

      // Recurse into children
      for (var c = 0; c < cc; c++) {
        walk(children[c], depth + 1);
      }
    }

    walk(container, 0);

    // Deduplicate: remove elements that are children of other found posts
    return uniquePostElements(posts);
  }

  // ── Extract author info ──────────────────────────────────────────────────

  function extractAuthor(el) {
    var name = null;
    var profileUrl = null;
    var avatarUrl = null;

    // h3 > a (most common pattern in 2025 FB)
    var h3 = el.querySelector("h3");
    if (h3) {
      var h3link = h3.querySelector("a[href]");
      if (h3link) {
        var h3text = (h3link.textContent || "").trim();
        if (h3text.length > 1 && h3text.length < 80 && isValidFacebookAuthor(h3text, h3link.href)) {
          name = h3text;
          profileUrl = h3link.href;
        }
      }
      if (!name) {
        name = (h3.textContent || "").trim();
        if (name.length > 80 || name.length < 2) name = null;
      }
    }

    // h4 > a
    if (!name) {
      var h4 = el.querySelector("h4 a[href]");
      if (h4) {
        var h4text = (h4.textContent || "").trim();
        if (isValidFacebookAuthor(h4text, h4.href)) {
          name = h4text;
          profileUrl = h4.href;
        }
      }
    }

    // aria-label links (skip generic labels)
    if (!name) {
      var ariaLinks = el.querySelectorAll('a[aria-label][href]');
      for (var i = 0; i < ariaLinks.length; i++) {
        var label = ariaLinks[i].getAttribute("aria-label") || "";
        if (
          label.length > 2 &&
          label.length < 80 &&
          isValidFacebookAuthor(label, ariaLinks[i].href) &&
          !/^(Like|Comment|Share|Reply|More|See|View|Photo|Video|Haha|Wow|Sad|Angry|Love|Care|Open|Close|Play|Mute)/i.test(
            label
          )
        ) {
          name = label.trim();
          profileUrl = ariaLinks[i].href;
          break;
        }
      }
    }

    // Profile link by URL pattern
    if (!name) {
      var links = el.querySelectorAll("a[href]");
      for (var j = 0; j < Math.min(links.length, 10); j++) {
        var href = links[j].href || "";
        if (
          href.match(/facebook\.com\/[\w.]+\/?(\?|$)/) &&
          !href.includes("/groups/") &&
          !href.includes("/pages/") &&
          !href.includes("/settings") &&
          !href.includes("/marketplace") &&
          isValidFacebookActorUrl(href)
        ) {
          var lt = (links[j].textContent || links[j].getAttribute("aria-label") || "").trim();
          if (lt.length > 1 && lt.length < 80 && !isFacebookUiChromeLabel(lt)) {
            name = lt;
            profileUrl = href;
            break;
          }
        }
      }
    }

    // Avatar: small image (20-70px)
    var imgs = el.querySelectorAll("img");
    for (var m = 0; m < Math.min(imgs.length, 5); m++) {
      var w = imgs[m].width || imgs[m].naturalWidth;
      var ih = imgs[m].height || imgs[m].naturalHeight;
      if (w > 20 && w < 70 && ih > 20 && ih < 70 && imgs[m].src) {
        avatarUrl = imgs[m].src;
        break;
      }
    }

    if (!isValidFacebookAuthor(name, profileUrl)) {
      return { name: null, profileUrl: null, avatarUrl: null };
    }

    return { name: name, profileUrl: profileUrl, avatarUrl: avatarUrl };
  }

  // ── Extract post text ────────────────────────────────────────────────────

  function extractText(el) {
    // data-ad-comet-preview="message" (ad-style rendering)
    var textEl = el.querySelector(
      '[data-ad-comet-preview="message"], [data-ad-preview="message"]'
    );
    if (textEl) return textValue(textEl, 4000);

    // Find the largest dir="auto" block that looks like post content
    var dirAutos = el.querySelectorAll('[dir="auto"]');
    var best = "";
    for (var t = 0; t < dirAutos.length; t++) {
      var candidate = textValue(dirAutos[t], 4000);
      if (candidate.length > best.length && candidate.length > 15) {
        // Skip if it's just a heading (same text as an h3/h4)
        var heading = el.querySelector("h3, h4");
        if (heading && candidate === (heading.textContent || "").trim())
          continue;
        best = candidate;
      }
    }
    return best || null;
  }

  // ── Extract timestamp ────────────────────────────────────────────────────

  function extractTimestamp(el) {
    var timeEl = el.querySelector("time[datetime]");
    if (timeEl) return { seconds: null, iso: timeEl.getAttribute("datetime") };

    var abbrEl = el.querySelector("abbr[data-utime]");
    if (abbrEl) {
      var ut = abbrEl.getAttribute("data-utime");
      if (ut) return { seconds: parseInt(ut, 10) || null, iso: null };
    }

    // Text-based time patterns in links
    var links = el.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var lt = (links[i].textContent || "").trim();
      if (
        lt.match(/^\d+[hms]$/) ||
        lt.match(
          /^\d+\s*(hour|minute|second|day|week|month)s?\s*ago$/i
        ) ||
        lt.match(/^(Yesterday|Today|Just now)/i) ||
        lt.match(
          /^(January|February|March|April|May|June|July|August|September|October|November|December)/i
        )
      ) {
        var parsed = Date.parse(lt);
        if (!isNaN(parsed)) {
          return { seconds: Math.floor(parsed / 1000), iso: null };
        }
        return { seconds: null, iso: lt };
      }
    }

    // aria-label timestamps
    var ariaLinks = el.querySelectorAll("a[aria-label]");
    for (var j = 0; j < ariaLinks.length; j++) {
      var al = ariaLinks[j].getAttribute("aria-label") || "";
      if (
        al.match(
          /\d{1,2}\s+(hour|minute|second|day|week|month|year)s?\s+ago/i
        ) ||
        al.match(
          /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/i
        )
      ) {
        var parsed2 = Date.parse(al);
        if (!isNaN(parsed2))
          return { seconds: Math.floor(parsed2 / 1000), iso: null };
        return { seconds: null, iso: al };
      }
    }

    return { seconds: null, iso: null };
  }

  // ── Extract post URL / ID ────────────────────────────────────────────────

  function extractPostId(el) {
    var links = el.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || "";
      var m =
        href.match(/story_fbid=(\d+)/) ||
        href.match(/\/groups\/[^/]+\/posts\/(\d+)/) ||
        href.match(/\/groups\/[^/]+\/permalink\/(\d+)/) ||
        href.match(/\/posts\/(\d+)/) ||
        href.match(/\/permalink\/(\d+)/) ||
        href.match(/(pfbid\w+)/);
      if (m) return { id: m[1], url: href };
    }
    var dataFt = el.getAttribute("data-ft") || "";
    var topLevelPost = dataFt.match(/top_level_post_id["']?\s*:\s*["']?([0-9]+)/);
    if (topLevelPost) {
      return { id: topLevelPost[1], url: null };
    }
    return { id: null, url: null };
  }

  function isSuggestedOrSponsored(el) {
    if (el.querySelector('[data-testid="sponsored_label"]')) return true;
    if (el.querySelector('[aria-label="Sponsored"]')) return true;

    var fullText = textValue(el, 2000);
    if (/suggested for you|people you may know|recommended for you|recommended/i.test(fullText)) {
      return true;
    }

    var header = el.querySelector("h3, h4, header");
    var headerScope = header || el;
    var buttons = headerScope.querySelectorAll('div[role="button"], button, a[role="link"]');
    for (var i = 0; i < buttons.length; i++) {
      var label =
        (buttons[i].getAttribute("aria-label") || "").trim() ||
        (buttons[i].textContent || "").trim();
      if (/^follow$|^follow back$/i.test(label)) {
        return true;
      }
    }

    return false;
  }

  function extractGroup(el) {
    var links = el.querySelectorAll('a[href*="/groups/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || "";
      var m = href.match(/facebook\.com\/groups\/([^/?]+)/);
      if (!m) continue;

      var name = (links[i].textContent || "").trim();
      if (!name) {
        var heading = links[i].closest("h3, h4");
        name = (heading && heading.textContent ? heading.textContent : "").trim();
      }
      if (!name) name = m[1];

      return {
        id: m[1],
        name: name,
        url: href,
      };
    }
    return null;
  }

  // ── Main ────────────────────────────────────────────────────────────────

  try {
    var feedContainer = findFeedContainer();
    var postEls = [];
    var strategy = "none";
    var pageState = classifyPageState(feedContainer);

    if (pageState.state === "not_authenticated" || pageState.state === "short_non_feed") {
      emit("fb-feed-data", {
        posts: [],
        error: pageState.message,
        extractedAt: Date.now(),
        url: window.location.href,
        scrapeRunId: scrapeRunId,
        strategy: pageState.state,
        candidateCount: 0,
        scrollY: window.scrollY,
        feedContainerFound: !!feedContainer,
        pageState: pageState,
        rejected: {
          suggestedOrSponsored: 0,
          missingAuthor: 0,
          missingContent: 0,
        },
      });
      return;
    }

    if (feedContainer) {
      postEls = findPostsInContainer(feedContainer);
      strategy = "feed-posts-h3";
    }

    // Fallback: try role="main" directly
    if (postEls.length === 0) {
      var mainEl = document.querySelector('div[role="main"]');
      if (mainEl) {
        postEls = findPostsInContainer(mainEl);
        strategy = "role-main-fallback";
      }
    }

    // Fallback: Facebook sometimes renders feed units without the old
    // "Feed posts" h3 or a stable role=main container.
    if (postEls.length === 0) {
      postEls = findPostsInContainer(document.body);
      strategy = "document-feedunit-fallback";
    }

    var posts = [];
    var rejected = {
      suggestedOrSponsored: 0,
      missingAuthor: 0,
      missingContent: 0,
    };
    for (var idx = 0; idx < postEls.length && posts.length < 50; idx++) {
      var el = postEls[idx];
      expandLongTextControls(el);

      if (isSuggestedOrSponsored(el)) {
        rejected.suggestedOrSponsored++;
        continue;
      }

      var author = extractAuthor(el);
      var text = extractText(el);
      var ts = extractTimestamp(el);
      var postRef = extractPostId(el);
      var group = extractGroup(el);

      if (!author.name || !author.profileUrl) {
        rejected.missingAuthor++;
        continue;
      }

      // Extract media
      var imgEls = el.querySelectorAll(
        'img[src*="scontent"], img[src*="fbcdn"]'
      );
      var seenSrc = {};
      var mediaUrls = [];
      for (var mi = 0; mi < imgEls.length; mi++) {
        var src = imgEls[mi].src;
        var w = imgEls[mi].width || imgEls[mi].naturalWidth;
        if (src && w > 80 && !src.includes("emoji") && !seenSrc[src]) {
          seenSrc[src] = true;
          mediaUrls.push(src);
        }
      }

      var hasVideo = el.querySelector("video") !== null;

      // Must have SOME meaningful content
      if (!text && mediaUrls.length === 0 && !hasVideo) {
        rejected.missingContent++;
        continue;
      }

      var id = postRef.id || contentHash(author.name, text || mediaUrls[0] || postRef.url);

      var reactionSpan = el.querySelector(
        'span[aria-label*="reaction"], span[aria-label*=" people"]'
      );
      var commentSpan = el.querySelector('span[aria-label*="comment"]');
      var shareSpan = el.querySelector('span[aria-label*="share"]');

      posts.push({
        id: id,
        url: postRef.url,
        authorName: author.name,
        authorProfileUrl: author.profileUrl,
        authorAvatarUrl: author.avatarUrl,
        text: text,
        timestampSeconds: ts.seconds,
        timestampIso: ts.iso,
        mediaUrls: mediaUrls,
        hasVideo: hasVideo,
        likeCount: parseEngagement(
          reactionSpan
            ? reactionSpan.getAttribute("aria-label") ||
                reactionSpan.textContent
            : null
        ),
        commentCount: parseEngagement(
          commentSpan
            ? commentSpan.getAttribute("aria-label") ||
                commentSpan.textContent
            : null
        ),
        shareCount: parseEngagement(
          shareSpan
            ? shareSpan.getAttribute("aria-label") || shareSpan.textContent
            : null
        ),
        postType: hasVideo ? "reel" : "post",
        location: null,
        hashtags: text ? extractHashtags(text) : [],
        isShare: false,
        sharedFrom: null,
        group: group,
        strategy: strategy,
      });
    }

    emit("fb-feed-data", {
      posts: posts,
      extractedAt: Date.now(),
      url: window.location.href,
      scrapeRunId: scrapeRunId,
      strategy: strategy,
      candidateCount: postEls.length,
      scrollY: window.scrollY,
      feedContainerFound: !!feedContainer,
      pageState: pageState,
      rejected: rejected,
    });
  } catch (err) {
    emit("fb-feed-data", {
      posts: [],
      error: err.message || String(err),
      extractedAt: Date.now(),
      url: window.location.href,
      scrapeRunId: scrapeRunId,
    });
  }
})();
