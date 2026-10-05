import { expect, it, vi } from 'vitest';
import { FriendsGalaxySourceScheduler, friendsGalaxySourceControls } from './friends-galaxy-source-scheduler.js';
it('coalesces background revision bursts without reseeding the scene, while explicit controls remain immediate', () => {
 vi.useFakeTimers();
 try {
  const flush = vi.fn(); const scheduler = new FriendsGalaxySourceScheduler<any>({ flush });
  const input = { mode: 'friends', backgroundStarCount: 500, proceduralBackgroundStarCount: 1000, sourceRetry: 0, sourceVersion: 1 };
  let previous = friendsGalaxySourceControls(input).key;
  scheduler.request({ sourceVersion: 1, ...friendsGalaxySourceControls(input) });
  for (let sourceVersion = 2; sourceVersion <= 60; sourceVersion++) {
   const controls = friendsGalaxySourceControls({ ...input, sourceVersion });
   scheduler.request({ sourceVersion, ...controls }, previous !== controls.key); previous = controls.key;
  }
  expect(flush).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(600); expect(flush).toHaveBeenCalledTimes(2);
  expect(flush.mock.calls[1][0].sourceVersion).toBe(60);
  expect(flush.mock.calls[0][0].backgroundSeed).toBe(flush.mock.calls[1][0].backgroundSeed);
  const changed = friendsGalaxySourceControls({ ...input, sourceVersion: 61, mode: 'all_content' });
  scheduler.request({ sourceVersion: 61, ...changed }, previous !== changed.key);
  expect(flush).toHaveBeenCalledTimes(3); scheduler.dispose();
 } finally { vi.useRealTimers(); }
});
