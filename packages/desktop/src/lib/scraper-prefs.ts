/**
 * Per-platform scraper window preferences.
 *
 * These are device-local settings that control how each scraper WebView runs
 * during feed extraction. They live in localStorage and are intentionally not
 * synced, because window behavior is specific to the current machine.
 */

export type ScraperWindowMode = "shown" | "cloaked" | "hidden";

const DEFAULT_SCRAPER_WINDOW_MODE: ScraperWindowMode = "cloaked";

const IG_KEY = "ig_scraper_debug_window";
const FB_KEY = "fb_scraper_debug_window";
const LI_KEY = "li_scraper_debug_window";

function readMode(key: string): ScraperWindowMode {
  const stored = localStorage.getItem(key);
  if (stored === "shown" || stored === "cloaked" || stored === "hidden") {
    return stored;
  }

  // Legacy migration: the old boolean flag only supported "shown" vs the
  // default background mode. Any non-true legacy value falls back to cloaked.
  if (stored === "true") {
    return "shown";
  }

  return DEFAULT_SCRAPER_WINDOW_MODE;
}

function writeMode(key: string, mode: ScraperWindowMode): void {
  if (mode === DEFAULT_SCRAPER_WINDOW_MODE) {
    localStorage.removeItem(key);
    return;
  }

  localStorage.setItem(key, mode);
}

export function getFbScraperWindowMode(): ScraperWindowMode {
  return readMode(FB_KEY);
}

export function setFbScraperWindowMode(mode: ScraperWindowMode): void {
  writeMode(FB_KEY, mode);
}

export function getIgScraperWindowMode(): ScraperWindowMode {
  return readMode(IG_KEY);
}

export function setIgScraperWindowMode(mode: ScraperWindowMode): void {
  writeMode(IG_KEY, mode);
}

export function getLiScraperWindowMode(): ScraperWindowMode {
  return readMode(LI_KEY);
}

export function setLiScraperWindowMode(mode: ScraperWindowMode): void {
  writeMode(LI_KEY, mode);
}
