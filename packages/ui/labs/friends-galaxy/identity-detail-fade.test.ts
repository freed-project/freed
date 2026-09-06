import { expect, it } from "vitest";
import { FriendsGalaxyIdentityDetailFade, friendsGalaxyIdentityDetailTargetOpacity } from "../../src/lib/friends-galaxy-identity-detail-fade.js";
import { FriendsGalaxyLabelFade } from "../../src/lib/friends-galaxy-label-fade.js";

it("has only discrete zoom targets, including the former translucent band", () => {
  for (const scale of [0, 0.58, 0.78, 0.899, NaN]) expect(friendsGalaxyIdentityDetailTargetOpacity(scale)).toBe(0);
  for (const scale of [0.9, 0.98, 1, 3]) expect(friendsGalaxyIdentityDetailTargetOpacity(scale)).toBe(1);
});

it("matches label timing through entry, reversal and complete exit", () => {
  const avatars = new FriendsGalaxyIdentityDetailFade();
  const labels = new FriendsGalaxyLabelFade<{ id: string }>();
  const layer = [{ id: "test" }];
  for (const [scale, time] of [[0.5, 0], [0.95, 16], [0.95, 136], [0.8, 152], [0.8, 212], [1, 228], [1, 468], [0.78, 484], [0.78, 724]]) {
    const rows = labels.step(layer, new Set(scale! >= 0.9 ? ["test"] : []), time!, true);
    expect(avatars.step(scale!, time!, true).opacity).toBe(rows[0]?.opacity ?? 0);
  }
  expect(avatars.currentOpacity).toBe(0);
  expect(avatars.isActive).toBe(false);
});

it("settles fully at fixed zoom, supports reduced motion, and resets only explicitly", () => {
  const fade = new FriendsGalaxyIdentityDetailFade();
  fade.step(0.95, 0, true);
  expect(fade.step(0.95, 240, true).opacity).toBe(1);
  expect(fade.step(0.95, 5000, true).opacity).toBe(1);
  expect(fade.step(0.78, 5016, false).opacity).toBe(0);
  expect(fade.step(1, 5032, false).opacity).toBe(1);
  fade.restartFromHidden();
  const result = fade.step(1, 5050, true);
  expect(result.opacity).toBe(0);
  expect(fade.step(1, 5066, true)).toBe(result);
});
