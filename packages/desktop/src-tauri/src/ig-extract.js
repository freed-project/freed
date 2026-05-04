// Self-contained extraction script injected into the Instagram WebView.
// Instagram 2025-2026: the feed wraps each post in <article> elements
// with semantic header/footer structure. Unlike Facebook, Instagram uses
// stable <article> boundaries, making post detection more reliable.
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

  function parseEngagement(text) {
    if (!text) return null;
    var cleaned = text.replace(/[^0-9.,KMkm]/g, "").replace(",", "");
    if (!cleaned) return null;
    var num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    if (/[Kk]/.test(text)) return Math.round(num * 1000);
    if (/[Mm]/.test(text)) return Math.round(num * 1000000);
    return Math.round(num);
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
      if (label === "more" || label === "see more" || label === "show more" || label === "read more") {
        try {
          controls[i].click();
          clicked++;
        } catch (_) {}
      }
    }
  }

  function contentHash(author, text) {
    var seed = (author || "") + "||" + (text || "").substring(0, 120);
    var hash = 0;
    for (var c = 0; c < seed.length; c++) {
      hash = (hash << 5) - hash + seed.charCodeAt(c);
      hash |= 0;
    }
    return "ig_" + Math.abs(hash).toString(36);
  }

  // ── Extract shortcode from a URL ──────────────────────────────────────────

  function extractShortcode(url) {
    if (!url) return null;
    var m = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  // ── Extract author from an article element ────────────────────────────────

  var IG_USERNAME_RE = /instagram\.com\/([A-Za-z0-9_.]+)\/?(?:\?|$|#)/;
  var IG_SKIP_PATHS = /^(p|reel|stories|explore|accounts|direct|tv|ar|challenge|audio|location|tags)$/i;

  function extractAuthor(article) {
    var handle = null;
    var displayName = null;
    var avatarUrl = null;
    var profileUrl = null;

    // Strategy 1: any link in the header/header-area that points to a profile
    var header = article.querySelector("header") || article;
    var allLinks = header.querySelectorAll("a[href]");
    for (var i = 0; i < allLinks.length; i++) {
      var link = allLinks[i];
      var href = link.href || "";
      var m = href.match(IG_USERNAME_RE);
      if (m && !IG_SKIP_PATHS.test(m[1])) {
        handle = m[1];
        profileUrl = href;
        var linkText = (link.textContent || "").trim();
        if (linkText && linkText.length > 0 && linkText.length < 80) {
          displayName = linkText;
        }
        break;
      }
    }

    // Strategy 2: span with aria-label containing "username" or similar
    if (!handle) {
      var spans = article.querySelectorAll("span[class]");
      for (var s = 0; s < spans.length; s++) {
        var txt = (spans[s].textContent || "").trim();
        // Username-like: no spaces, has at least one letter, reasonable length
        if (txt && txt.length > 1 && txt.length < 40 && /^[A-Za-z0-9._]+$/.test(txt)) {
          // Make sure the span is near the top of the article (within header area)
          var rect = spans[s].getBoundingClientRect();
          var articleRect = article.getBoundingClientRect();
          if (rect.top - articleRect.top < 100) {
            handle = txt;
            break;
          }
        }
      }
    }

    // Strategy 3: look for a link with an href anywhere in article (fallback)
    if (!handle) {
      var bodyLinks = article.querySelectorAll("a[href]");
      for (var b = 0; b < bodyLinks.length && b < 10; b++) {
        var bHref = bodyLinks[b].href || "";
        var bm = bHref.match(IG_USERNAME_RE);
        if (bm && !IG_SKIP_PATHS.test(bm[1])) {
          handle = bm[1];
          profileUrl = bHref;
          break;
        }
      }
    }

    // Avatar: small circular image in header
    var headerEl = article.querySelector("header");
    var avatarImg = headerEl ? headerEl.querySelector("img") : null;
    if (avatarImg && avatarImg.src) {
      var w = avatarImg.width || avatarImg.naturalWidth;
      var h = avatarImg.height || avatarImg.naturalHeight;
      if (w > 10 && w < 100 && h > 10 && h < 100) {
        avatarUrl = avatarImg.src;
      }
    }

    return {
      handle: handle,
      displayName: displayName || handle,
      avatarUrl: avatarUrl,
      profileUrl: profileUrl,
    };
  }

  // ── Extract caption text ──────────────────────────────────────────────────

  function extractCaption(article) {
    // Try the structured caption container first
    var captionEl = article.querySelector("._a9zr, ._a9zs");
    if (captionEl) {
      var spans = captionEl.querySelectorAll("span");
      var texts = [];
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].innerText || "").trim();
        if (t.length > 0) texts.push(t);
      }
      if (texts.length > 0) return texts.join(" ");
    }

    // Fallback: h1 with spans (common in single-post views)
    var h1 = article.querySelector("h1");
    if (h1) {
      var h1text = (h1.innerText || "").trim();
      if (h1text.length > 10) return h1text;
    }

    // Fallback: largest dir="auto" text block
    var dirAutos = article.querySelectorAll('[dir="auto"]');
    var best = "";
    for (var d = 0; d < dirAutos.length; d++) {
      var candidate = (dirAutos[d].innerText || "").trim();
      if (candidate.length > best.length && candidate.length > 15) {
        // Skip if it looks like the author name
        var header = article.querySelector("header");
        if (header && header.contains(dirAutos[d])) continue;
        best = candidate;
      }
    }
    return best || null;
  }

  // ── Extract timestamp ─────────────────────────────────────────────────────

  function extractTimestamp(article) {
    var timeEl = article.querySelector("time[datetime]");
    if (timeEl) return timeEl.getAttribute("datetime");
    return null;
  }

  // ── Extract post URL / shortcode ──────────────────────────────────────────

  function extractPostUrl(article) {
    var links = article.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || "";
      if (href.match(/\/(?:p|reel)\/[A-Za-z0-9_-]+/)) {
        return href;
      }
    }
    return null;
  }

  // ── Extract media ─────────────────────────────────────────────────────────

  function extractMedia(article) {
    var urls = [];
    var seen = {};

    // Images: scontent or cdninstagram URLs
    var imgs = article.querySelectorAll(
      'img[srcset], img[src*="cdninstagram"], img[src*="instagram"], img[src*="scontent"]'
    );
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].src;
      var w = imgs[i].width || imgs[i].naturalWidth;
      // Skip tiny images (avatars, icons, emojis)
      if (src && w > 100 && !src.includes("emoji") && !seen[src]) {
        seen[src] = true;
        urls.push(src);
      }
    }

    return urls;
  }

  // ── Extract engagement ────────────────────────────────────────────────────

  function extractEngagement(article) {
    var likeCount = null;
    var commentCount = null;

    // Like count: button or span with "like" text patterns
    var sections = article.querySelectorAll("section");
    for (var s = 0; s < sections.length; s++) {
      var text = (sections[s].innerText || "").toLowerCase();
      // "1,234 likes" or "Liked by X and 1,234 others"
      var likeMatch = text.match(/([\d,]+)\s*like/);
      if (likeMatch) {
        likeCount = parseEngagement(likeMatch[1]);
      }
      var othersMatch = text.match(/([\d,]+)\s*other/);
      if (othersMatch && likeCount === null) {
        likeCount = parseEngagement(othersMatch[1]);
      }
    }

    // Comment count from "View all N comments" link
    var commentLink = article.querySelector('a[href*="/comments"]');
    if (!commentLink) {
      // Fallback: look for text pattern
      var allSpans = article.querySelectorAll("span");
      for (var c = 0; c < allSpans.length; c++) {
        var spanText = (allSpans[c].textContent || "").trim();
        var commentMatch = spanText.match(/View all ([\d,]+) comment/i);
        if (commentMatch) {
          commentCount = parseEngagement(commentMatch[1]);
          break;
        }
      }
    } else {
      var clText = (commentLink.textContent || "").trim();
      var clMatch = clText.match(/([\d,]+)/);
      if (clMatch) commentCount = parseEngagement(clMatch[1]);
    }

    return { likeCount: likeCount, commentCount: commentCount };
  }

  // ── Extract location ──────────────────────────────────────────────────────

  function extractLocation(article) {
    var locLink = article.querySelector('a[href*="/explore/locations/"]');
    if (locLink) {
      return {
        name: (locLink.textContent || "").trim(),
        url: locLink.href,
      };
    }
    return { name: null, url: null };
  }

  // ── Filter suggested / sponsored / non-following content ─────────────────

  function isSuggestedOrSponsored(article) {
    // "Suggested for you" / "Suggested Posts" label anywhere in article
    var fullText = (article.innerText || "");
    if (/suggested|reels you might like/i.test(fullText)) {
      return true;
    }

    // Follow button in the header = post from a non-followed account
    var header = article.querySelector("header");
    if (header) {
      var buttons = header.querySelectorAll("button");
      for (var b = 0; b < buttons.length; b++) {
        var btnText = (buttons[b].textContent || "").trim();
        if (btnText === "Follow" || btnText === "Follow Back") return true;
      }
    }

    // Sponsored indicator: aria-label="Sponsored" or link to /ads/
    if (article.querySelector('[aria-label="Sponsored"]')) return true;
    if (article.querySelector('a[href*="/ads/"]')) return true;

    return false;
  }

  // ── Locate feed article elements ──────────────────────────────────────────
  // Instagram 2025+: primary container is <article>, but may also use
  // [role="article"] or large div blocks inside the main feed section.

  function findArticles() {
    var articles = Array.prototype.slice.call(document.querySelectorAll("article"));
    if (articles.length >= 2) return articles;

    // Fallback: [role="article"]
    var roleArticles = Array.prototype.slice.call(document.querySelectorAll('[role="article"]'));
    if (roleArticles.length > articles.length) articles = roleArticles;

    // Fallback: look inside main > section for large post-like divs
    if (articles.length < 2) {
      var main = document.querySelector('main') || document.querySelector('[role="main"]');
      if (main) {
        var divs = main.querySelectorAll('div');
        var candidates = [];
        for (var i = 0; i < divs.length; i++) {
          var d = divs[i];
          // Post-like: tall, has an image/video and a timestamp
          if (d.offsetHeight > 300 &&
              (d.querySelector('time') || d.querySelector('img[src*="cdninstagram"], img[src*="scontent"]'))) {
            candidates.push(d);
          }
        }
        // Remove elements that contain other candidates (keep the smallest enclosing)
        var dedupedCandidates = candidates.filter(function(el, idx) {
          for (var j = 0; j < candidates.length; j++) {
            if (idx !== j && candidates[j].contains(el) && candidates[j] !== el) return false;
          }
          return true;
        });
        if (dedupedCandidates.length > articles.length) articles = dedupedCandidates;
      }
    }

    return articles;
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  try {
    var articles = findArticles();
    var posts = [];
    var seen = {};

    for (var idx = 0; idx < articles.length && posts.length < 50; idx++) {
      var article = articles[idx];

      // Skip tiny or invisible articles
      if (article.offsetHeight < 100) continue;
      expandLongTextControls(article);

      // Skip suggested-for-you, sponsored, and non-followed-account posts
      if (isSuggestedOrSponsored(article)) continue;

      var author = extractAuthor(article);
      var caption = extractCaption(article);
      var postUrl = extractPostUrl(article);
      var shortcode = extractShortcode(postUrl);
      var timestampIso = extractTimestamp(article);
      var mediaUrls = extractMedia(article);
      var hasVideo = article.querySelector("video") !== null;
      var hasCarousel = article.querySelector('button[aria-label="Next"]') !== null;
      var engagement = extractEngagement(article);
      var location = extractLocation(article);

      // Must have some meaningful content
      if (!caption && mediaUrls.length === 0 && !hasVideo) continue;

      var id = shortcode || contentHash(author.handle, caption);

      // Deduplicate across scroll passes
      if (seen[id]) continue;
      seen[id] = true;

      var postType = "unknown";
      if (hasVideo && postUrl && postUrl.includes("/reel/")) {
        postType = "reel";
      } else if (hasVideo) {
        postType = "video";
      } else if (hasCarousel) {
        postType = "carousel";
      } else if (mediaUrls.length > 0) {
        postType = "photo";
      }

      posts.push({
        shortcode: shortcode,
        url: postUrl,
        authorHandle: author.handle,
        authorDisplayName: author.displayName,
        authorAvatarUrl: author.avatarUrl,
        authorProfileUrl: author.profileUrl,
        caption: caption,
        timestampIso: timestampIso,
        mediaUrls: mediaUrls,
        isVideo: hasVideo,
        isCarousel: hasCarousel,
        likeCount: engagement.likeCount,
        commentCount: engagement.commentCount,
        hashtags: caption ? extractHashtags(caption) : [],
        location: location.name,
        locationUrl: location.url,
        postType: postType,
      });
    }

    emit("ig-feed-data", {
      posts: posts,
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: articles.length,
      scrollY: window.scrollY,
      strategy: articles.length > 0 ? (articles[0].tagName || 'DIV').toLowerCase() : 'none',
    });
  } catch (err) {
    emit("ig-feed-data", {
      posts: [],
      error: err.message || String(err),
      extractedAt: Date.now(),
      url: window.location.href,
    });
  }
})();
