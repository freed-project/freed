import { describe, expect, it } from "vitest";
import { mergeDefaultPreferences, type UserPreferences } from "@freed/shared";

describe("mergeDefaultPreferences", () => {
  it("fills current reading defaults for sparse historical input", () => {
    const preferences = mergeDefaultPreferences({
      display: {
        themeId: "neon",
      },
    } as unknown as Partial<UserPreferences>);

    expect(preferences.display.reading.markReadOnScroll).toBe(true);
    expect(preferences.display.reading.showReadInGrayscale).toBe(true);
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
