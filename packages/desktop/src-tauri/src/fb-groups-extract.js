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

  try {
    var links = document.querySelectorAll('a[href*="/groups/"]');
    var seen = {};
    var groups = [];

    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || "";
      var match = href.match(/facebook\.com\/groups\/([^/?]+)/);
      if (!match) continue;

      var id = match[1];
      if (
        !id ||
        id === "feed" ||
        id === "discover" ||
        id === "joins" ||
        id === "category"
      ) {
        continue;
      }

      if (seen[id]) continue;

      var name = (links[i].textContent || "").trim();
      if (!name) {
        var heading = links[i].querySelector("h1, h2, h3, h4, span");
        name = (heading && heading.textContent ? heading.textContent : "").trim();
      }
      if (!name) {
        var container = links[i].closest('div, li, section, article');
        if (container) {
          var nearby = container.querySelector("h1, h2, h3, h4, strong, span");
          name = (nearby && nearby.textContent ? nearby.textContent : "").trim();
        }
      }
      if (!name) name = id;

      seen[id] = true;
      groups.push({
        id: id,
        name: name,
        url: normalizeGroupUrl(href),
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
