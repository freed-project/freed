// Extract visible Facebook post comments from an authenticated WebView.
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

  function clickCommentExpanders() {
    var controls = document.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]');
    var clicked = 0;
    for (var i = 0; i < controls.length && clicked < 12; i++) {
      var label = (
        controls[i].getAttribute("aria-label") ||
        controls[i].textContent ||
        ""
      ).trim().toLowerCase();
      if (
        /^(see more|view more comments|more comments|previous comments|view previous comments|view more replies|more replies|see more replies|show more replies)$/.test(label) ||
        label.indexOf("view more comments") >= 0 ||
        label.indexOf("view more replies") >= 0
      ) {
        try {
          controls[i].click();
          clicked++;
        } catch (_) {}
      }
    }
  }

  function hash(seed) {
    var value = 0;
    for (var i = 0; i < seed.length; i++) {
      value = (value << 5) - value + seed.charCodeAt(i);
      value |= 0;
    }
    return Math.abs(value).toString(36);
  }

  function cleanLines(text) {
    return (text || "")
      .split(/\n+/)
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        if (!line) return false;
        return !/^(like|reply|share|send|follow|edited|author|top fan|view replies|view more replies|see more|more)$/i.test(line);
      });
  }

  function extractAuthor(root) {
    var links = root.querySelectorAll("a[href]");
    for (var i = 0; i < Math.min(links.length, 8); i++) {
      var text = (links[i].textContent || "").trim();
      var href = links[i].href || "";
      if (
        text.length >= 2 &&
        text.length <= 80 &&
        href.indexOf("facebook.com") >= 0 &&
        !/^(like|reply|share|send|follow|photo|video)$/i.test(text)
      ) {
        return {
          name: text,
          handle: null,
          url: href,
        };
      }
    }

    var strong = root.querySelector("strong");
    var strongText = strong ? (strong.textContent || "").trim() : "";
    if (strongText.length >= 2 && strongText.length <= 80) {
      return { name: strongText, handle: null, url: null };
    }

    return { name: "Facebook user", handle: null, url: null };
  }

  function extractMedia(root) {
    var urls = [];
    var types = [];
    var seen = {};

    var imgs = root.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]');
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].currentSrc || imgs[i].src || "";
      if (!src || seen[src]) continue;
      var width = imgs[i].naturalWidth || imgs[i].width || 0;
      var height = imgs[i].naturalHeight || imgs[i].height || 0;
      if (width <= 80 && height <= 80) continue;
      seen[src] = true;
      urls.push(src);
      types.push("image");
    }

    var videos = root.querySelectorAll("video");
    for (var v = 0; v < videos.length; v++) {
      var videoSrc = videos[v].currentSrc || videos[v].src || videos[v].poster || "";
      if (!videoSrc || seen[videoSrc]) continue;
      seen[videoSrc] = true;
      urls.push(videoSrc);
      types.push(videoSrc === videos[v].poster ? "image" : "video");
    }

    return { urls: urls, types: types };
  }

  function looksLikeComment(root) {
    var text = (root.innerText || "").trim();
    if (text.length < 8 || text.length > 1500) return false;
    if (!/\b(Like|Reply)\b/i.test(text)) return false;
    if (/\b(Write a comment|Comment as|Add a comment|Most relevant|All comments)\b/i.test(text)) return false;
    var rect = root.getBoundingClientRect();
    if (rect.height < 24 || rect.height > 900 || rect.width < 180) return false;
    return true;
  }

  function extractComment(root) {
    var author = extractAuthor(root);
    var lines = cleanLines(root.innerText || "");
    var filtered = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === author.name) continue;
      if (/^\d+\s*(m|h|d|w|y|min|hr|hrs|day|days|week|weeks)$/i.test(lines[i])) continue;
      if (/^\d+\s*(like|likes|reply|replies)$/i.test(lines[i])) continue;
      filtered.push(lines[i]);
    }
    var text = filtered.join("\n").trim();
    var media = extractMedia(root);
    if (!text && media.urls.length === 0) return null;
    return {
      id: "fb-comment:" + hash((author.name || "") + "|" + text + "|" + media.urls.join("|")),
      authorName: author.name,
      authorHandle: author.handle,
      authorAvatarUrl: null,
      text: text || undefined,
      mediaUrls: media.urls,
      mediaTypes: media.types,
      sourceUrl: author.url || window.location.href,
    };
  }

  try {
    clickCommentExpanders();

    var roots = [];
    var selectors = [
      '[aria-label*="Comment by"]',
      '[role="article"]',
      'div[aria-label*="Comment"]',
      'div[aria-label*="comment"]',
    ];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        if (looksLikeComment(node)) roots.push(node);
      });
    });

    var seen = {};
    var comments = [];
    roots.forEach(function (root) {
      var comment = extractComment(root);
      if (!comment || seen[comment.id]) return;
      seen[comment.id] = true;
      comments.push(comment);
    });

    emit("fb-comments-data", {
      comments: comments.slice(0, 40),
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: roots.length,
    });
  } catch (error) {
    emit("fb-comments-data", {
      comments: [],
      error: error && error.message ? error.message : String(error),
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: 0,
    });
  }
})();
