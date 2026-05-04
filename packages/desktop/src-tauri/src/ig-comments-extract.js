// Extract visible Instagram post or reel comments from an authenticated WebView.
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

  var USERNAME_RE = /instagram\.com\/([A-Za-z0-9_.]+)\/?(?:\?|$|#)/;
  var SKIP_PATHS = /^(p|reel|stories|explore|accounts|direct|tv|challenge|audio|location|tags)$/i;

  function clickCommentExpanders() {
    var controls = document.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]');
    var clicked = 0;
    for (var i = 0; i < controls.length && clicked < 10; i++) {
      var label = (
        controls[i].getAttribute("aria-label") ||
        controls[i].textContent ||
        ""
      ).trim().toLowerCase();
      if (
        label === "more" ||
        label === "view all comments" ||
        label.indexOf("view all") === 0 ||
        label.indexOf("load more comments") >= 0 ||
        label.indexOf("view replies") >= 0 ||
        label.indexOf("more replies") >= 0
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

  function authorFrom(root) {
    var links = root.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || "";
      var match = href.match(USERNAME_RE);
      if (!match || SKIP_PATHS.test(match[1])) continue;
      var handle = match[1];
      var name = (links[i].textContent || "").trim() || handle;
      if (name.length > 80) name = handle;
      return {
        name: name,
        handle: handle,
        url: href,
      };
    }
    return null;
  }

  function mediaFrom(root) {
    var urls = [];
    var types = [];
    var seen = {};
    var imgs = root.querySelectorAll('img[src*="cdninstagram"], img[src*="scontent"]');
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
    return { urls: urls, types: types };
  }

  function cleanText(root, author) {
    var lines = (root.innerText || "")
      .split(/\n+/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    var filtered = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === author.name || line === author.handle) continue;
      if (/^(reply|see translation|view replies|hide replies|more)$/i.test(line)) continue;
      if (/^\d+\s*(like|likes|reply|replies)$/i.test(line)) continue;
      if (/^\d+\s*(m|h|d|w|y|min|hr|hrs|day|days|week|weeks)$/i.test(line)) continue;
      filtered.push(line);
    }
    return filtered.join("\n").trim();
  }

  function looksLikeComment(root) {
    var author = authorFrom(root);
    if (!author) return false;
    var text = (root.innerText || "").trim();
    if (text.length < author.name.length + 2 || text.length > 1200) return false;
    var rect = root.getBoundingClientRect();
    if (rect.height < 24 || rect.height > 700 || rect.width < 180) return false;
    return true;
  }

  function extractComment(root) {
    var author = authorFrom(root);
    if (!author) return null;
    var text = cleanText(root, author);
    var media = mediaFrom(root);
    if (!text && media.urls.length === 0) return null;
    return {
      id: "ig-comment:" + hash(author.handle + "|" + text + "|" + media.urls.join("|")),
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
    var container = document.querySelector("article") || document.body;
    var roots = [];
    container.querySelectorAll("ul li, ol li").forEach(function (node) {
      if (looksLikeComment(node)) roots.push(node);
    });

    if (roots.length === 0) {
      container.querySelectorAll("div").forEach(function (node) {
        if (looksLikeComment(node)) roots.push(node);
      });
    }

    var seen = {};
    var comments = [];
    roots.forEach(function (root) {
      var comment = extractComment(root);
      if (!comment || seen[comment.id]) return;
      seen[comment.id] = true;
      comments.push(comment);
    });

    emit("ig-comments-data", {
      comments: comments.slice(0, 40),
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: roots.length,
    });
  } catch (error) {
    emit("ig-comments-data", {
      comments: [],
      error: error && error.message ? error.message : String(error),
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: 0,
    });
  }
})();
