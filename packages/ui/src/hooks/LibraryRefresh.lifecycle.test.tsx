/** @vitest-environment jsdom */
// Changed-path contracts: bounded committed presentation, never old reader identity.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ platform: {} as any }));
vi.mock('../context/PlatformContext.js', () => ({ usePlatform: () => fixture.platform }));
import { useLibraryMapCandidates, useLibraryStoryWallCandidates } from './useLibrarySurfaceItems.js';
import { useLibrarySavedAnalytics } from './useLibrarySavedAnalytics.js';
import { useLibraryFilterScopeSummary } from './useLibraryFilterScopeSummary.js';
import { useFeedSignalCounts } from './useFeedSignalCounts.js';
import { useLibraryPersonDetail } from './useLibraryIdentityDetail.js';
import { useLibraryRssFeedDetail } from './useLibraryRssFeedDetail.js';
const item: any = { globalId: 'synthetic', platform: 'rss', author: { id: 'a', handle: 'a', displayName: 'Synthetic' }, content: { text: 'apple', mediaUrls: [], mediaTypes: [] }, userState: { tags: [], saved: false, archived: false, hidden: false }, topics: [], publishedAt: 1, capturedAt: 1, contentType: 'article' };
const analytics = { totalCount: 3, latestSavedAt: 1, dailyCounts: Array(7).fill(0), hourlyCounts: Array(24).fill(0), sourceCounts: [], contentMix: [] };
const scope = { label: 'Synthetic', itemCount: 3 };
const counts = { all: 3, inspiring: 0, events: 0, personal: 0, conversation: 0, news: 0 };
const feed = { title: 'Synthetic', url: 'https://synthetic.invalid/feed', enabled: true, trackUnread: true, folder: null, imageUrl: null, lastFetched: null, pollInterval: null, sampleBatchId: null, siteUrl: null };
const cases = [
 { name: 'map', reader: 'readLibraryMapCandidates', good: [item], zero: [], hook: (v: number) => useLibraryMapCandidates(v), value: (x: any) => x },
 { name: 'stories', reader: 'readLibraryStoryWallCandidates', good: [item], zero: [], hook: (v: number) => useLibraryStoryWallCandidates(v), value: (x: any) => x },
 { name: 'analytics', reader: 'readLibrarySavedAnalytics', good: analytics, zero: { ...analytics, totalCount: 0 }, hook: (v: number) => useLibrarySavedAnalytics(v), value: (x: any) => x.analytics },
 { name: 'scope summary', reader: 'queryLibraryCore', good: scope, zero: { ...scope, itemCount: 0 }, hook: (v: number) => useLibraryFilterScopeSummary({ feedUrl: feed.url }, v), value: (x: any) => x.summary },
 { name: 'signal counts', reader: 'readFeedSignalCounts', good: counts, zero: { ...counts, all: 0 }, hook: (v: number) => useFeedSignalCounts({} as any, v, true), value: (x: any) => x },
 { name: 'person detail', reader: 'readLibraryPersonDetail', good: { id: 'a', name: 'Synthetic' }, zero: null, hook: (v: number) => useLibraryPersonDetail('a', v), value: (x: any) => x.value },
 { name: 'RSS detail', reader: 'queryLibraryCore', good: { feed }, zero: { feed: null }, hook: (v: number) => useLibraryRssFeedDetail(feed.url, v), value: (x: any) => x.feed },
];
function deferred() { let resolve!: (x: any) => void, reject!: (x: Error) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
for (const c of cases) describe(`${c.name} actual-hook refresh lifecycle`, () => {
 let root: Root, current: any, reader: any, seen: any[];
 beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.platform = {}; seen = []; root = createRoot(document.createElement('div'));
  reader = vi.fn(async () => c.good);
  if (c.name === 'search') fixture.platform[c.reader] = async (_q: any, _v: any, emit: any) => { const rows = await reader(); emit(rows.map((item: any) => ({ item, score: 1 }))); };
  else fixture.platform[c.reader] = reader;
 });
 afterEach(async () => { await act(async () => root.unmount()); });
 function Probe({ version }: { version: number }) { current = c.hook(version); seen.push(c.value(current)); return null; }
 const render = async (version: number) => { await act(async () => root.render(<Probe version={version} />)); };
 const empty = (x: any) => x === null || (Array.isArray(x) ? x.length === 0 : c.name === 'signal counts' ? x.all === 0 : false);
 it('retains during delayed overlap, ignores obsolete completion and applies settled zero', async () => {
  await render(1); const committed = c.value(current); expect(empty(committed)).toBe(false);
  const old = deferred(), latest = deferred(); reader.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await render(2); expect(c.value(current)).toEqual(committed);
  await render(3); expect(c.value(current)).toEqual(committed);
  await act(async () => latest.resolve(c.zero)); const zero = c.value(current); expect(zero).not.toEqual(committed);
  await act(async () => old.resolve(c.good)); expect(c.value(current)).toEqual(zero);
 });
 it('clears immediately for reader replacement and revision rewind', async () => {
  await render(5); expect(empty(c.value(current))).toBe(false);
  const pending = deferred(); const replacement = vi.fn(() => pending.promise);
  fixture.platform[c.reader] = c.name === "search" ? async (_q: any, _v: any, emit: any) => { const rows = await replacement(); emit(rows.map((item: any) => ({ item, score: 1 }))); } : replacement;
  seen = []; await render(5); expect(empty(seen[0])).toBe(true); expect(empty(c.value(current))).toBe(true);
  await act(async () => pending.resolve(c.good)); expect(empty(c.value(current))).toBe(false);
  const rewind = deferred(); replacement.mockReturnValueOnce(rewind.promise);
  await render(1); expect(empty(c.value(current))).toBe(true);
 });
 it('clears failed committed data and does not resurrect it during a retry', async () => {
  await render(1); const failed = deferred(); reader.mockReturnValueOnce(failed.promise); await render(2);
  await act(async () => failed.reject(new Error('synthetic failure'))); expect(empty(c.value(current))).toBe(true);
  const retry = deferred(); reader.mockReturnValueOnce(retry.promise); await render(3); expect(empty(c.value(current))).toBe(true);
  await act(async () => retry.resolve(c.good)); expect(empty(c.value(current))).toBe(false);
 });
});
