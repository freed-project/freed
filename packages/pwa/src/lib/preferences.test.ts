import { describe, expect, it } from "vitest";
import { mergeDefaultPreferences, type UserPreferences } from "@freed/shared";

describe("mergeDefaultPreferences", () => {
  it("fills reading defaults for legacy preference documents", () => {
    const preferences = mergeDefaultPreferences({
      display: {
        themeId: "neon",
      },
    } as Partial<UserPreferences>);

    expect(preferences.display.themeId).toBe("neon");
    expect(preferences.display.reading.markReadOnScroll).toBe(true);
    expect(preferences.display.reading.showReadInGrayscale).toBe(true);
    expect(preferences.display.reading.dualColumnMode).toBe(true);
  });

  it("preserves explicit reading preferences", () => {
    const preferences = mergeDefaultPreferences({
      display: {
        reading: {
          markReadOnScroll: false,
          showReadInGrayscale: false,
        },
      },
    } as Partial<UserPreferences>);

    expect(preferences.display.reading.markReadOnScroll).toBe(false);
    expect(preferences.display.reading.showReadInGrayscale).toBe(false);
    expect(preferences.display.reading.focusMode).toBe(false);
  });
});
