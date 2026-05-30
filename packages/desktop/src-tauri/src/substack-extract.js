(function () {
  try {
    var now = Date.now();
    var profiles = [];
    var entries = [];
    var seenProfiles = new Set();
    var seenEntries = new Set();

    function text(node) {
      return (node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim();
    }

    function abs(href) {
      try {
        return new URL(href, window.location.href).href;
      } catch (_) {
        return "";
      }
    }

    document.querySelectorAll('a[href*="substack.com/@"], a[href^="/@"]').forEach(function (link) {
      var url = abs(link.getAttribute("href") || "");
      if (!url || seenProfiles.has(url)) return;
      seenProfiles.add(url);
      var handle = "";
      try {
        handle = (new URL(url).pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "");
      } catch (_) {}
      profiles.push({
        id: url,
        handle: handle,
        displayName: text(link) || handle,
        profileUrl: url,
        role: "following",
        firstSeenAt: now,
        lastSeenAt: now
      });
    });

    document.querySelectorAll("article, [data-testid], .post-preview, .note, .feed-item").forEach(function (node) {
      var link = node.querySelector('a[href*="/p/"], a[href*="substack.com/p/"], a[href*="/notes/"], a[href*="/note/"]');
      var url = link ? abs(link.getAttribute("href") || "") : "";
      var body = text(node);
      if (!url || !body || seenEntries.has(url)) return;
      seenEntries.add(url);
      var titleNode = node.querySelector("h1,h2,h3,strong");
      var authorLink = node.querySelector('a[href*="substack.com/@"], a[href^="/@"]');
      var authorUrl = authorLink ? abs(authorLink.getAttribute("href") || "") : "";
      var authorHandle = "";
      try {
        authorHandle = authorUrl ? (new URL(authorUrl).pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "") : "";
      } catch (_) {}
      entries.push({
        id: url,
        kind: url.indexOf("/p/") >= 0 ? "essay" : "note",
        url: url,
        title: titleNode ? text(titleNode) : undefined,
        text: body,
        publishedAt: now,
        capturedAt: now,
        author: authorUrl ? {
          id: authorUrl,
          handle: authorHandle,
          displayName: text(authorLink) || authorHandle,
          profileUrl: authorUrl,
          role: "author"
        } : undefined
      });
    });

    window.__TAURI__.event.emit("substack-feed-data", {
      entries: entries,
      profiles: profiles,
      extractedAt: now,
      url: window.location.href,
      candidateCount: entries.length + profiles.length
    });
  } catch (error) {
    window.__TAURI__.event.emit("substack-feed-data", {
      entries: [],
      profiles: [],
      error: error && error.message ? error.message : String(error),
      extractedAt: Date.now(),
      url: window.location.href,
      candidateCount: 0
    });
  }
})();
