import { beforeEach, describe, expect, it } from "vitest";
import {
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

  it("defaults all scraper modes to cloaked", () => {
    expect(getFbScraperWindowMode()).toBe("cloaked");
    expect(getIgScraperWindowMode()).toBe("cloaked");
    expect(getLiScraperWindowMode()).toBe("cloaked");
  });

  it("migrates the legacy true flag to shown", () => {
    localStorage.setItem("fb_scraper_debug_window", "true");

    expect(getFbScraperWindowMode()).toBe("shown");
  });

  it("falls back to cloaked for missing or legacy false values", () => {
    localStorage.setItem("ig_scraper_debug_window", "false");

    expect(getIgScraperWindowMode()).toBe("cloaked");
  });

  it("persists hidden and shown modes", () => {
    setFbScraperWindowMode("hidden");
    setIgScraperWindowMode("shown");

    expect(localStorage.getItem("fb_scraper_debug_window")).toBe("hidden");
    expect(localStorage.getItem("ig_scraper_debug_window")).toBe("shown");
  });

  it("removes storage when mode returns to cloaked", () => {
    setLiScraperWindowMode("shown");
    setLiScraperWindowMode("cloaked");

    expect(localStorage.getItem("li_scraper_debug_window")).toBeNull();
    expect(getLiScraperWindowMode()).toBe("cloaked");
  });
});
