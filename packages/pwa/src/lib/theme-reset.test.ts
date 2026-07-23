import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  getStoredThemeId,
  resetThemePreference,
} from "@freed/ui/lib/theme";

describe("theme factory reset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("removes the device theme and restores the default on the next read", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "ember");

    resetThemePreference();

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getStoredThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it("propagates storage removal failures", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => resetThemePreference()).toThrow("storage unavailable");
  });
});
