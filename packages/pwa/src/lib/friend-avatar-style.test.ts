import { afterEach, describe, expect, it, vi } from "vitest";
import { createFriendAvatarPalette } from "../../../ui/src/lib/friend-avatar-style";

describe("friend avatar palette", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back cleanly when document is unavailable", () => {
    const palette = createFriendAvatarPalette();
    expect(palette.gradientStart).toContain("color-mix");
    expect(palette.imageOverlay).toContain("radial-gradient");
  });

  it("reads avatar palette values from theme CSS variables", () => {
    const vars: Record<string, string> = {
      "--theme-avatar-border-strong": "border-strong",
      "--theme-avatar-border-soft": "border-soft",
      "--theme-avatar-glow": "glow",
      "--theme-avatar-glow-soft": "glow-soft",
      "--theme-avatar-ring": "ring",
      "--theme-avatar-gradient-start": "gradient-start",
      "--theme-avatar-gradient-mid": "gradient-mid",
      "--theme-avatar-gradient-end": "gradient-end",
      "--theme-avatar-image-overlay": "image-overlay",
      "--theme-avatar-image-shadow": "image-shadow",
      "--theme-avatar-image-highlight": "image-highlight",
      "--theme-avatar-selection-stroke": "selection-stroke",
      "--theme-avatar-selection-outer-stroke": "selection-outer-stroke",
      "--theme-avatar-label-border": "label-border",
      "--theme-avatar-initials-shadow": "initials-shadow",
      "--theme-avatar-text": "text",
    };

    vi.stubGlobal("document", {
      documentElement: {},
    });
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) => vars[name] ?? "",
    }));

    const palette = createFriendAvatarPalette("scriptorium");

    expect(palette.borderStrong).toBe("border-strong");
    expect(palette.gradientEnd).toBe("gradient-end");
    expect(palette.imageOverlay).toBe("image-overlay");
    expect(palette.text).toBe("text");
  });
});
