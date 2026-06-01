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

  function normalizeGroupUrl(href) {
    try {
      var url = new URL(href, window.location.href);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return href;
    }
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .replace(/(\S)(last active\b)/i, "$1 $2")
      .trim();
  }

  function getGroupId(href) {
    try {
      var url = new URL(href, window.location.href);
      var match = url.pathname.match(/\/groups\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      var fallback = String(href || "").match(/facebook\.com\/groups\/([^/?#]+)/);
      return fallback ? decodeURIComponent(fallback[1]) : "";
    }
  }

  function isReservedGroupPath(id) {
    return (
      !id ||
      id === "feed" ||
      id === "discover" ||
      id === "joins" ||
      id === "category"
    );
  }

  function isUsableGroupName(name, id) {
    var text = normalizeText(name);
    var lower = text.toLowerCase();
    var idLower = String(id || "").trim().toLowerCase();

    if (text.length < 2) return false;
    if (lower === idLower) return false;
    if (/^https?:\/\//i.test(text)) return false;
    if (/^\d{5,}$/.test(text)) return false;
    if (/^[\d\s,._-]+$/.test(text)) return false;
    if (
      /^(?:\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)(?:\s+ago)?|just now)$/i.test(text)
    ) {
      return false;
    }
    if (
      /^(?:groups?|your groups|joined|join group|visit group|public group|private group|last active|new activity|notifications?|see all)$/i.test(text)
    ) {
      return false;
    }
    if (/^last active\b/i.test(text)) return false;

    return true;
  }

  function scoreGroupName(name) {
    var text = normalizeText(name);
    var score = Math.min(text.length, 80);
    if (/\blast active\b/i.test(text)) score += 25;
    if (/\b(public|private)\s+group\b/i.test(text)) score -= 20;
    if (text.length > 140) score -= 40;
    return score;
  }

  function addCandidate(candidates, value, id, sourceBonus) {
    var name = normalizeText(value);
    if (!isUsableGroupName(name, id)) return;
    candidates.push({
      name: name,
      score: scoreGroupName(name) + sourceBonus,
    });
  }

  function collectCandidatesFromElement(candidates, element, id, sourceBonus) {
    if (!element) return;

    addCandidate(candidates, element.getAttribute("aria-label"), id, sourceBonus + 8);
    addCandidate(candidates, element.getAttribute("title"), id, sourceBonus + 6);
    addCandidate(candidates, element.textContent, id, sourceBonus);

    var labels = element.querySelectorAll(
      'h1, h2, h3, h4, strong, span[dir="auto"], [aria-label], [title]',
    );
    for (var i = 0; i < labels.length; i++) {
      addCandidate(candidates, labels[i].getAttribute("aria-label"), id, sourceBonus + 8);
      addCandidate(candidates, labels[i].getAttribute("title"), id, sourceBonus + 6);
      addCandidate(candidates, labels[i].textContent, id, sourceBonus + 4);
    }
  }

  function chooseGroupName(links, id) {
    var candidates = [];

    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      collectCandidatesFromElement(candidates, link, id, 20);

      var container =
        link.closest('[role="listitem"]') ||
        link.closest("li") ||
        link.closest("article") ||
        link.closest("section") ||
        link.closest("div");
      collectCandidatesFromElement(candidates, container, id, 0);
    }

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    return candidates.length > 0 ? candidates[0].name : "";
  }

  try {
    var links = document.querySelectorAll('a[href*="/groups/"]');
    var linksById = {};
    var urlsById = {};
    var groups = [];

    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || "";
      var id = getGroupId(href);
      if (isReservedGroupPath(id)) continue;

      if (!linksById[id]) {
        linksById[id] = [];
        urlsById[id] = href;
      }
      linksById[id].push(links[i]);
    }

    var ids = Object.keys(linksById);
    for (var j = 0; j < ids.length; j++) {
      var id = ids[j];
      var name = chooseGroupName(linksById[id], id);
      if (!name) continue;

      groups.push({
        id: id,
        name: name,
        url: normalizeGroupUrl(urlsById[id]),
      });
    }

    emit("fb-groups-data", {
      groups: groups,
      extractedAt: Date.now(),
      url: window.location.href,
    });
  } catch (err) {
    emit("fb-groups-data", {
      groups: [],
      error: err && err.message ? err.message : String(err),
      extractedAt: Date.now(),
      url: window.location.href,
    });
  }
})();
