import { describe, expect, it } from "vitest";
import {
  FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_END_SCALE,
  FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_START_SCALE,
  FriendsGalaxyIdentityDetailFade,
  friendsGalaxyIdentityDetailTargetOpacity,
} from "../../src/lib/friends-galaxy-identity-detail-fade.js";

describe("Friends Galaxy identity detail fade", () => {
  it("uses a smooth scale band instead of a discrete close-detail threshold", () => {
    expect(friendsGalaxyIdentityDetailTargetOpacity(
      FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_START_SCALE,
    )).toBe(0);
    expect(friendsGalaxyIdentityDetailTargetOpacity(0.78)).toBeCloseTo(0.5, 8);
    expect(friendsGalaxyIdentityDetailTargetOpacity(
      FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_END_SCALE,
    )).toBe(1);
  });

  it("fades in over elapsed time without appearing on the threshold frame", () => {
    const fade = new FriendsGalaxyIdentityDetailFade();
    fade.step(0.5, 0, true);
    const thresholdFrame = fade.step(1, 16, true);
    expect(thresholdFrame.opacity).toBeGreaterThan(0);
    expect(thresholdFrame.opacity).toBeLessThan(1);
    expect(thresholdFrame.active).toBe(true);

    let settled = thresholdFrame;
    for (let timeMs = 32; timeMs <= 1_500; timeMs += 16) {
      settled = fade.step(1, timeMs, true);
      if (!settled.active) break;
    }
    expect(settled.opacity).toBe(1);
    expect(settled.active).toBe(false);
  });

  it("fades out from its current opacity and reverses without a jump", () => {
    const fade = new FriendsGalaxyIdentityDetailFade();
    fade.step(1, 0, false);
    expect(fade.currentOpacity).toBe(1);

    const outward = fade.step(0.4, 16, true);
    expect(outward.opacity).toBeGreaterThan(0);
    expect(outward.opacity).toBeLessThan(1);
    const beforeReverse = outward.opacity;
    const inward = fade.step(1, 32, true);
    expect(inward.opacity).toBeGreaterThan(beforeReverse);
    expect(inward.opacity).toBeLessThan(1);
  });

  it("settles immediately when animation is disabled", () => {
    const fade = new FriendsGalaxyIdentityDetailFade();
    const visible = fade.step(1, 0, false);
    expect(visible).toEqual({
      opacity: 1,
      targetOpacity: 1,
      active: false,
      changed: true,
    });
    const hidden = fade.step(0.4, 16, false);
    expect(hidden.opacity).toBe(0);
    expect(hidden.active).toBe(false);
  });

  it("restarts replacement icon sets from transparent and reuses its step object", () => {
    const fade = new FriendsGalaxyIdentityDetailFade();
    fade.step(1, 0, false);
    fade.restartFromHidden();
    const first = fade.step(1, 16, true);
    expect(first.opacity).toBe(0);
    expect(first.active).toBe(true);
    expect(fade.step(1, 32, true)).toBe(first);
  });
});
