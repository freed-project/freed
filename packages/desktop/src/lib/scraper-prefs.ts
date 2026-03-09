/**
 * Per-platform scraper debug preferences.
 *
 * These are device-local flags that control whether the scraper WebView
 * window is shown on-screen (debug mode) or positioned off-screen during
 * feed extraction. They are stored in localStorage and intentionally NOT
 * synced via Automerge -- debug flags belong to the local machine only.
 */

const IG_KEY = "ig_scraper_debug_window";
const FB_KEY = "fb_scraper_debug_window";

export const getIgScraperDebugWindow = (): boolean =>
  localStorage.getItem(IG_KEY) === "true";

export const setIgScraperDebugWindow = (v: boolean): void => {
  if (v) {
    localStorage.setItem(IG_KEY, "true");
  } else {
    localStorage.removeItem(IG_KEY);
  }
};

export const getFbScraperDebugWindow = (): boolean =>
  localStorage.getItem(FB_KEY) === "true";

export const setFbScraperDebugWindow = (v: boolean): void => {
  if (v) {
    localStorage.setItem(FB_KEY, "true");
  } else {
    localStorage.removeItem(FB_KEY);
  }
};
