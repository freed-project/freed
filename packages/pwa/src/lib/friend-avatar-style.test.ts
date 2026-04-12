import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID } from "@freed/shared/themes";
import { createFriendAvatarPalette } from "../../../ui/src/lib/friend-avatar-style";

describe("friend avatar palette", () => {
  it("uses the active theme tint when none is provided", () => {
    const palette = createFriendAvatarPalette();
    expect(palette.tintHex).toBe(createFriendAvatarPalette(DEFAULT_THEME_ID).tintHex);
    expect(palette.gradientStart).toContain("rgba(");
  });

  it("falls back to the default theme when no theme is passed", () => {
    const palette = createFriendAvatarPalette(undefined);
    expect(palette.tintHex).toBe(createFriendAvatarPalette(DEFAULT_THEME_ID).tintHex);
  });

  it("uses distinct theme-authored tints", () => {
    const palette = createFriendAvatarPalette("scriptorium");
    expect(palette.tintHex).toBe("#9b7655");
    expect(palette.borderStrong).toContain("rgba(");
    expect(palette.imageOverlay).toContain("radial-gradient");
  });
});
