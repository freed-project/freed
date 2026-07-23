(function () {
  var EVENT_NAME = "medium-feed-data";
  var MAX_TEXT_CHARS = 40000;
  var MAX_PROFILES = 500;
  var MAX_ENTRIES = 250;
  var ROSTER_STORAGE_KEY = "freed.essay.roster.v1";

  function emit(payload) {
    window.__TAURI__.event.emit(EVENT_NAME, payload);
  }

  function cleanText(value, maxChars) {
    return String(value || "")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars || MAX_TEXT_CHARS);
  }

  function canonicalUrl(value) {
    try {
      if (!value) return "";
      var url = new URL(value, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      url.hash = "";
      Array.from(url.searchParams.keys()).forEach(function (key) {
        if (key === "source" || key === "sk" || key === "ref" || key.indexOf("utm_") === 0) {
          url.searchParams.delete(key);
        }
      });
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
      return url.href;
    } catch (_) {
      return "";
    }
  }

  function profileIdentity(urlValue) {
    try {
      var canonical = canonicalUrl(urlValue);
      if (!canonical) return null;
      var url = new URL(canonical);
      if (url.hostname !== "medium.com" && url.hostname !== "www.medium.com") return null;
      var parts = url.pathname.split("/").filter(Boolean);
      var handle = parts.length === 1 && parts[0].charAt(0) === "@" ? parts[0] : "";
      handle = handle.replace(/^@/, "").toLowerCase();
      if (handle) return { url: "https://medium.com/@" + handle, handle: handle, kind: "person" };
      var publication = parts.length === 1 ? parts[0].toLowerCase() : "";
      if (!publication || /^(about|creators|feed|m|me|membership|new-story|p|search|tag|topic)$/.test(publication)) {
        return null;
      }
      if (!/^[a-z0-9][a-z0-9._-]{1,99}$/i.test(publication)) return null;
      return {
        url: "https://medium.com/" + publication,
        handle: publication,
        kind: "publication"
      };
    } catch (_) {
      return null;
    }
  }

  function timestamp(node) {
    var time = node && node.querySelector("time[datetime]");
    return time ? time.getAttribute("datetime") || undefined : undefined;
  }

  function imageUrls(node) {
    var urls = [];
    if (!node) return urls;
    node.querySelectorAll("img[src], img[data-src]").forEach(function (image) {
      var profileLink = image.closest("a[href]");
      if (profileLink && profileIdentity(profileLink.getAttribute("href"))) return;
      var url = canonicalUrl(image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src"));
      if (url && urls.indexOf(url) === -1 && urls.length < 12) urls.push(url);
    });
    return urls;
  }

  function profileFromLink(link, role, now, rosterRow) {
    var identity = profileIdentity(link && link.getAttribute("href"));
    if (!identity) return null;
    var url = identity.url;
    var handle = identity.handle;
    var container = rosterRow || link.closest("article, li, [role='listitem'], [data-testid], div") || link;
    var image = container.querySelector && container.querySelector("img[src], img[data-src]");
    var avatarUrl = canonicalUrl(image && (image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src")));
    var nameCandidates = [link.getAttribute("aria-label"), link.textContent];
    if (container.querySelectorAll) {
      container.querySelectorAll("h1, h2, h3, h4, [data-testid*='name'], a[href]").forEach(function (node) {
        if (node.matches && node.matches("a[href]")) {
          var candidateIdentity = profileIdentity(node.getAttribute("href"));
          if (!candidateIdentity || candidateIdentity.url !== url) return;
        }
        nameCandidates.push(node.getAttribute && node.getAttribute("aria-label"));
        nameCandidates.push(node.textContent);
      });
    }
    var displayName = nameCandidates
      .map(function (value) { return cleanText(value, 500); })
      .filter(function (value) {
        return value && !/^(follow|following|follows you|subscribe|subscribed)$/i.test(value);
      })
      .sort(function (left, right) {
        var leftScore = (left.toLowerCase() === handle ? 0 : 1000) + left.length;
        var rightScore = (right.toLowerCase() === handle ? 0 : 1000) + right.length;
        return rightScore - leftScore;
      })[0];
    return {
      id: url,
      handle: handle || undefined,
      displayName: displayName || handle || undefined,
      avatarUrl: avatarUrl || undefined,
      profileUrl: url,
      role: identity.kind === "publication" ? "subscription" : role,
      firstSeenAt: now,
      lastSeenAt: now
    };
  }

  function isStoryUrl(value) {
    try {
      var url = new URL(value);
      var path = url.pathname;
      if (/^\/(?:m\/signin|me(?:\/|$)|search(?:\/|$)|tag(?:\/|$)|topic(?:\/|$))/.test(path)) return false;
      if (/\/p\/[a-z0-9]+/i.test(path)) return true;
      if (/\/@[^/]+\/[^/]+-[a-f0-9]{6,}$/i.test(path)) return true;
      return /\/[^/]+-[a-f0-9]{6,}$/i.test(path);
    } catch (_) {
      return false;
    }
  }

  function rosterContainer(link) {
    if (!link || link.closest("header, nav, footer, [role='banner'], [role='navigation']")) {
      return null;
    }
    var main = link.closest("main, [role='main']");
    if (!main) return null;
    var row = link.closest(
      "article, li, [role='listitem'], [data-testid*='user'], [data-testid*='profile'], [data-testid*='follow']"
    );
    if (!row) {
      var fallback = link.closest("section, div");
      if (
        fallback &&
        fallback !== main &&
        fallback.querySelector("img") &&
        fallback.querySelectorAll("a[href]").length <= 6
      ) {
        row = fallback;
      }
    }
    if (!row || !main.contains(row)) return null;
    return cleanText(row.textContent, 2000).length <= 1500 ? row : null;
  }

  function loadRosterState(scope, relation) {
    var token = cleanText(window.__FREED_ESSAY_CAPTURE_TOKEN, 200);
    var state = { token: token, ids: [], roles: [] };
    if (scope !== "graph" || !relation || !token) return state;
    try {
      var parsed = JSON.parse(window.sessionStorage.getItem(ROSTER_STORAGE_KEY) || "null");
      if (parsed && parsed.token === token) {
        state.ids = Array.isArray(parsed.ids) ? parsed.ids.slice(0, MAX_PROFILES) : [];
        state.roles = Array.isArray(parsed.roles) ? parsed.roles.slice(0, MAX_PROFILES * 3) : [];
      }
    } catch (_) {
      // The in-page sets still enforce the limit when session storage is unavailable.
    }
    return state;
  }

  function persistRosterState(state) {
    if (!state.token) return;
    try {
      window.sessionStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Capture can continue with the current page's in-memory state.
    }
  }

  function entryUrl(node) {
    var links = node.querySelectorAll("a[href]");
    for (var index = 0; index < links.length; index += 1) {
      var url = canonicalUrl(links[index].getAttribute("href"));
      if (isStoryUrl(url)) return url;
    }
    return "";
  }

  function activityMarkerText(node) {
    var values = [];
    node.querySelectorAll("header, footer, [data-testid*='activity'], [data-testid*='social'], [aria-label]").forEach(function (marker) {
      var value = marker.getAttribute("aria-label") || marker.textContent;
      var normalized = cleanText(value, 1000);
      if (marker.matches("[aria-label]") &&
          !marker.matches("header, footer, [data-testid*='activity'], [data-testid*='social']") &&
          !/\bhighlighted\b|\bclapped\b|\bclap(?:ped)? for\b|\bresponded to\b|\bresponse to\b/i.test(normalized)) return;
      if (normalized && values.indexOf(normalized) === -1) values.push(normalized);
    });
    return cleanText(values.join(" "), 4000);
  }

  function entryKind(node, scope) {
    if (scope !== "activity") return "story";
    var markers = activityMarkerText(node);
    if (/\bhighlighted\b|\bhighlighted a passage\b/i.test(markers)) return "highlight";
    if (/\bclapped\b|\bclap(?:ped)? for\b/i.test(markers)) return "clap";
    if (/\bresponded to\b|\bresponse to\b/i.test(markers)) return "response";
    return "story";
  }

  try {
    var now = Date.now();
    var scope = window.__FREED_ESSAY_CAPTURE_SCOPE || "activity";
    var relation = window.__FREED_ESSAY_RELATION || null;
    var profiles = [];
    var entries = [];
    var seenProfiles = new Set();
    var seenEntries = new Set();
    var rosterSeen = null;
    var rosterIds = null;
    var rosterState = null;
    if (scope === "graph" && relation) {
      rosterState = loadRosterState(scope, relation);
      rosterSeen = new Set(rosterState.roles);
      rosterIds = new Set(rosterState.ids);
      window.__FREED_ESSAY_ROSTER_SEEN = rosterSeen;
      window.__FREED_ESSAY_ROSTER_IDS = rosterIds;
    }

    if (scope === "graph" && relation) {
      document.querySelectorAll('a[href]').forEach(function (link) {
        if (profiles.length >= MAX_PROFILES) return;
        var container = rosterContainer(link);
        if (!container) return;
        var profile = profileFromLink(link, relation, now, container);
        var profileKey = profile && profile.role + ":" + profile.id;
        if (!profile || seenProfiles.has(profileKey) || (rosterSeen && rosterSeen.has(profileKey))) return;
        if (rosterIds && !rosterIds.has(profile.id) && rosterIds.size >= MAX_PROFILES) return;
        seenProfiles.add(profileKey);
        if (rosterSeen) rosterSeen.add(profileKey);
        if (rosterIds) rosterIds.add(profile.id);
        profiles.push(profile);
      });
      if (rosterState && rosterSeen && rosterIds) {
        rosterState.ids = Array.from(rosterIds).slice(0, MAX_PROFILES);
        rosterState.roles = Array.from(rosterSeen).slice(0, MAX_PROFILES * 3);
        persistRosterState(rosterState);
      }
    } else if (scope === "activity" || scope === "essays") {
      document.querySelectorAll("article, [role='article'], [data-testid='post-preview'], .postArticle").forEach(function (node) {
        if (entries.length >= MAX_ENTRIES) return;
        var url = entryUrl(node);
        var body = cleanText(node.textContent);
        var kind = entryKind(node, scope);
        if (!url || !body) return;

        var authorLink = node.querySelector('a[href*="medium.com/@"], a[href^="/@"]');
        var author = authorLink ? profileFromLink(authorLink, "author", now) : null;
        var titleNode = node.querySelector("h1, h2, h3");
        var publishedAt = timestamp(node);
        var entry = {
          id: url,
          kind: kind,
          url: url,
          title: cleanText(titleNode && titleNode.textContent, 500) || undefined,
          publishedAt: publishedAt,
          capturedAt: now,
          mediaUrls: imageUrls(node),
          author: author || undefined
        };
        if (kind === "clap") {
          entry.activityLabel = activityMarkerText(node) || undefined;
        } else if (kind !== "story") {
          entry.text = body;
        }
        var entryKey = kind + ":" + url;
        if (kind !== "story") {
          entryKey += ":" + [
            author && author.id || "",
            publishedAt || "",
            entry.activityLabel || entry.text || ""
          ].join(":");
        }
        if (seenEntries.has(entryKey)) return;
        seenEntries.add(entryKey);
        entries.push(entry);
      });
    }

    emit({
      entries: entries,
      profiles: profiles,
      extractedAt: now,
      url: canonicalUrl(window.location.href),
      scope: scope,
      relation: relation,
      candidateCount: entries.length + profiles.length
    });
  } catch (error) {
    emit({
      entries: [],
      profiles: [],
      error: error && error.message ? error.message : String(error),
      extractedAt: Date.now(),
      url: canonicalUrl(window.location.href),
      candidateCount: 0
    });
  }
})();
