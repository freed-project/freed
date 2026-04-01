import { describe, expect, it } from "vitest";
import { DEFAULT_FRIEND_AVATAR_TINT } from "@freed/shared";
import { createFriendAvatarPalette } from "../../../ui/src/lib/friend-avatar-style";

describe("friend avatar palette", () => {
  it("uses the shared default tint when none is provided", () => {
    const palette = createFriendAvatarPalette();
    expect(palette.tintHex).toBe(DEFAULT_FRIEND_AVATAR_TINT);
    expect(palette.gradientStart).toContain("rgba(");
  });

  it("normalizes invalid values back to the shared default", () => {
    const palette = createFriendAvatarPalette("purple-ish");
    expect(palette.tintHex).toBe(DEFAULT_FRIEND_AVATAR_TINT);
  });

  it("preserves a valid custom tint", () => {
    const palette = createFriendAvatarPalette("#c9b1ff");
    expect(palette.tintHex).toBe("#c9b1ff");
    expect(palette.borderStrong).toContain("rgba(");
    expect(palette.imageOverlay).toContain("radial-gradient");
  });
});
