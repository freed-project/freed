// Read only the document already opened by the user's login flow. No fetch,
// navigation, clicks or media loads. Each document gets one bounded probe loop.
(function () {
  if (window.__FREED_FB_LOGIN_PROBE_STARTED) return;
  window.__FREED_FB_LOGIN_PROBE_STARTED = true;
  var remaining = 120;
  var emitting = false;

  function check() {
    if (window.__FREED_FB_LOGIN_AUTH_EMITTED || emitting) return;
    remaining -= 1;
    try {
      var host = window.location.hostname;
      var trusted = window.location.protocol === "https:" &&
        (host === "facebook.com" || host.endsWith(".facebook.com"));
      var prompt = /^\/(login|checkpoint|two_step_verification|recover|consent)(\/|\.|$)/i.test(window.location.pathname);
      var cookie = document.cookie.split(";").some(function (entry) {
        return /^c_user=[1-9][0-9]*$/.test(entry.trim());
      });
      // Preserve the existing rendered-feed fallback when WebKit hides cookies.
      var feed = document.querySelector('[role="article"], div[data-pagelet^="FeedUnit"], div[aria-posinset]') ||
        Array.prototype.some.call(document.querySelectorAll("h3"), function (heading) {
          return (heading.textContent || "").trim() === "Feed posts";
        });
      // A cookie on a checkpoint page is not proof the challenge is complete.
      if (trusted && !prompt && (cookie || feed)) {
        emitting = true;
        Promise.resolve(window.__TAURI__.event.emit("fb-auth-result", {
          loggedIn: true,
          source: "login_window"
        })).then(function () {
          window.__FREED_FB_LOGIN_AUTH_EMITTED = true;
        }).catch(function () {
          emitting = false;
          if (remaining > 0) window.setTimeout(check, 500);
        });
        return;
      }
    } catch (_) {
      emitting = false;
    }
    if (remaining > 0) window.setTimeout(check, 500);
  }
  window.setTimeout(check, 500);
})();
