import { beforeEach, describe, expect, it } from "vitest";
import {
  clearScraperWindowPreferences,
  getFbScraperWindowMode,
  getIgScraperWindowMode,
  getLiScraperWindowMode,
  setFbScraperWindowMode,
  setIgScraperWindowMode,
  setLiScraperWindowMode,
} from "./scraper-prefs";

describe("scraper-prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults all scraper modes to hidden", () => {
    expect(getFbScraperWindowMode()).toBe("hidden");
    expect(getIgScraperWindowMode()).toBe("hidden");
    expect(getLiScraperWindowMode()).toBe("hidden");
  });

  it("migrates the legacy true flag to shown", () => {
    localStorage.setItem("fb_scraper_debug_window", "true");

    expect(getFbScraperWindowMode()).toBe("shown");
  });

  it("falls back to hidden for missing or legacy false values", () => {
    localStorage.setItem("ig_scraper_debug_window", "false");

    expect(getIgScraperWindowMode()).toBe("hidden");
  });

  it("persists cloaked and shown modes", () => {
    setFbScraperWindowMode("cloaked");
    setIgScraperWindowMode("shown");

    expect(localStorage.getItem("fb_scraper_debug_window")).toBe("cloaked");
    expect(localStorage.getItem("ig_scraper_debug_window")).toBe("shown");
  });

  it("removes storage when mode returns to hidden", () => {
    setLiScraperWindowMode("shown");
    setLiScraperWindowMode("hidden");

    expect(localStorage.getItem("li_scraper_debug_window")).toBeNull();
    expect(getLiScraperWindowMode()).toBe("hidden");
  });

  it("clears every scraper mode without disturbing unrelated local state", () => {
    setFbScraperWindowMode("shown");
    setIgScraperWindowMode("cloaked");
    setLiScraperWindowMode("shown");
    localStorage.setItem("unrelated", "preserve");

    clearScraperWindowPreferences();

    expect(getFbScraperWindowMode()).toBe("hidden");
    expect(getIgScraperWindowMode()).toBe("hidden");
    expect(getLiScraperWindowMode()).toBe("hidden");
    expect(localStorage.getItem("unrelated")).toBe("preserve");
  });
});
