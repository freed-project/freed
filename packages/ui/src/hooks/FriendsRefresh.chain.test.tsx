/** @vitest-environment jsdom */
import { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ platform: {} as any }));
vi.mock('../context/PlatformContext.js', () => ({ usePlatform: () => fixture.platform }));
import { useLibraryFriendDetail } from './useLibraryIdentityDetail.js';
import { useLibraryFriendsRows } from './useLibraryFriendsRows.js';
import { createLibraryFriendsGraphRequest, friendTimelineBindingKey } from '../lib/friends-library-read-model.js';
const sources = [{ platform: 'x', authorId: 'synthetic' }];
const person = { id: 'friend-a', name: 'Synthetic', sources };
const item: any = { globalId: 'synthetic-post', platform: 'x', content: { text: 'Synthetic' } };
const graph = (count = 42) => ({ sourceToken: 'synthetic-source', totalItemCount: count, social: [], rss: [] });
const page = (count = 42) => ({ items: count ? [item] : [], totalCount: count, nextCursor: count ? 'synthetic-opaque' : null });
const deferred = () => { let resolve!: (x: any) => void, reject!: (x: Error) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let root: Root, current: any;
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 fixture.platform = { readLibraryFriendDetail: vi.fn(async () => person), readLibraryFriendsGraph: vi.fn(async () => graph()), readLibraryPersonTimeline: vi.fn(async () => page()) };
 root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });
function Probe({ version, id = 'friend-a' }: { version: number; id?: string }) {
 const detail = useLibraryFriendDetail(id, version);
 const key = friendTimelineBindingKey(detail.value, null);
 const scope = useMemo(() => detail.value?.sources ?? [], [key]);
 const request = useMemo(() => createLibraryFriendsGraphRequest(scope), [scope]);
 const identity = useMemo(() => detail.value ? { personId: detail.value.id } : null, [detail.value?.id]);
 const rows = useLibraryFriendsRows({ graphRequest: request, timelineSources: scope, locationSources: [], timelineIdentity: identity, sourceVersion: version });
 current = { detail, rows, scope };
 return null;
}
const render = async (version: number, id?: string) => { await act(async () => root.render(<Probe version={version} id={id} />)); };
it('rejects a captured opaque page callback after the timeline reader changes at equal revision', async () => {
 await render(1); const captured = current.rows.loadMoreTimeline; const oldReader = fixture.platform.readLibraryPersonTimeline;
 fixture.platform.readLibraryPersonTimeline = vi.fn(async () => page(30)); await render(1); oldReader.mockClear();
 await act(async () => captured());
 expect(oldReader).not.toHaveBeenCalled(); expect(current.rows.timelineTotalCount).toBe(30);
});
it('does not settle a replacement reader page when an old reader page rejects', async () => {
 await render(1); const old = deferred(); fixture.platform.readLibraryPersonTimeline.mockReturnValueOnce(old.promise);
 await act(async () => current.rows.loadMoreTimeline());
 fixture.platform.readLibraryPersonTimeline = vi.fn(async () => page(30)); await render(1);
 const replacement = deferred(); fixture.platform.readLibraryPersonTimeline.mockReturnValueOnce(replacement.promise);
 await act(async () => current.rows.loadMoreTimeline()); expect(current.rows.timelineLoadingMore).toBe(true);
 await act(async () => old.reject(new Error('old synthetic reader')));
 expect(current.rows.timelineLoadingMore).toBe(true);
 await act(async () => current.rows.loadMoreTimeline()); expect(fixture.platform.readLibraryPersonTimeline).toHaveBeenCalledTimes(2);
 await act(async () => replacement.resolve(page(25))); expect(current.rows.timelineLoadingMore).toBe(false);
});
it('does not present an old graph reader failure as a replacement reader failure', async () => {
 await render(1); fixture.platform.readLibraryFriendsGraph.mockRejectedValueOnce(new Error('old graph')); await render(2);
 expect(current.rows.graph).toBeNull(); expect(current.rows.graphLoading).toBe(false);
 const replacement = deferred(); fixture.platform.readLibraryFriendsGraph = vi.fn(() => replacement.promise); await render(2);
 expect(current.rows.graphLoading).toBe(true);
 await act(async () => replacement.resolve(graph(30))); expect(current.rows.graph.totalItemCount).toBe(30);
});
it('retains selected detail and 42 activity matches during overlap, fences opaque paging, and ignores late replies', async () => {
 await render(1); expect(current.rows.timelineTotalCount).toBe(42);
 const old = [deferred(), deferred(), deferred()], latest = [deferred(), deferred(), deferred()];
 for (const [index, key] of ['readLibraryFriendDetail', 'readLibraryFriendsGraph', 'readLibraryPersonTimeline'].entries()) fixture.platform[key].mockReturnValueOnce(old[index].promise).mockReturnValueOnce(latest[index].promise);
 await render(2); expect(current.detail.value.id).toBe('friend-a'); expect(current.rows.graph.totalItemCount).toBe(42); expect(current.rows.timelineTotalCount).toBe(42);
 expect(current.rows.timelineItems).toEqual([item]); expect(current.rows.timelineHasMore).toBe(false);
 await act(async () => current.rows.loadMoreTimeline()); expect(fixture.platform.readLibraryPersonTimeline).toHaveBeenCalledTimes(2);
 await render(3); expect(current.rows.timelineTotalCount).toBe(42);
 await act(async () => { latest[0].resolve({ ...person }); latest[1].resolve(graph(40)); latest[2].resolve(page(40)); });
 expect(current.rows.timelineTotalCount).toBe(40);
 await act(async () => { old[0].resolve(person); old[1].resolve(graph()); old[2].resolve(page()); });
 expect(current.rows.timelineTotalCount).toBe(40);
 const next = deferred(); fixture.platform.readLibraryFriendDetail.mockReturnValueOnce(next.promise);
 await render(3, 'friend-b'); expect(current.detail.value).toBeNull(); expect(current.rows.timelineTotalCount).toBe(0);
});
it('clears errors, retries honestly, and invalidates scope when same-ID bindings change', async () => {
 await render(1);
 const failed = deferred(); fixture.platform.readLibraryPersonTimeline.mockReturnValueOnce(failed.promise); await render(2);
 await act(async () => failed.reject(new Error('synthetic'))); expect(current.rows.timelineTotalCount).toBe(0);
 const retry = deferred(); fixture.platform.readLibraryPersonTimeline.mockReturnValueOnce(retry.promise); await render(3); expect(current.rows.timelineTotalCount).toBe(0);
 await act(async () => retry.resolve(page())); expect(current.rows.timelineTotalCount).toBe(42);
 fixture.platform.readLibraryFriendDetail.mockResolvedValueOnce({ ...person, sources: [{ platform: 'x', authorId: 'replacement-binding' }] });
 await render(4); expect(current.scope).toEqual([{ platform: 'x', authorId: 'replacement-binding' }]);
 expect(friendTimelineBindingKey(person as any, null)).not.toBe(friendTimelineBindingKey({ ...person, sources: current.scope } as any, null));
});
