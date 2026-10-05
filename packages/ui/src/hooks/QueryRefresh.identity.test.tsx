/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ platform: {} as any }));
vi.mock('../context/PlatformContext.js', () => ({ usePlatform: () => fixture.platform }));
import { useLibraryMapCandidates } from './useLibrarySurfaceItems';
import { useSearchResults } from './useSearchResults';
const row = { globalId: 'x:synthetic:a', platform: 'x', contentType: 'post', capturedAt: 1, publishedAt: 1, author: { id: 'a', handle: 'a', displayName: 'Synthetic A' }, content: { text: 'Synthetic apple', mediaUrls: [], mediaTypes: [] }, userState: { hidden: false, saved: false, archived: false, tags: [] }, topics: [] } as any;
const filter = {};
describe('query refresh identity acceptance', () => {
 let root: Root, host: HTMLDivElement, current: any;
 beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fixture.platform = {}; host = document.createElement('div'); root = createRoot(host); });
 afterEach(async () => { await act(async () => root.unmount()); });
 function Map({ version }: { version: number }) { current = useLibraryMapCandidates(version); return null; }
 function Search({ version, query = 'apple' }: { version: number; query?: string }) { current = useSearchResults(query, filter, version, 'all_content'); return null; }
 const render = async (node: any) => act(async () => root.render(node));
 const pending = () => new Promise<any>(() => {});
 it('clears map rows when reader changes at equal revision', async () => {
 fixture.platform.readLibraryMapCandidates = vi.fn(async () => [row]); await render(<Map version={1} />); expect(current).toEqual([row]);
 fixture.platform.readLibraryMapCandidates = vi.fn(pending); await render(<Map version={1} />); expect(current).toEqual([]);
 });
 it('retains map rows while same reader refreshes', async () => {
 fixture.platform.readLibraryMapCandidates = vi.fn().mockResolvedValueOnce([row]).mockImplementationOnce(pending); await render(<Map version={1} />); await render(<Map version={2} />); expect(current).toEqual([row]);
 });
 const searcher = () => vi.fn().mockImplementationOnce(async (_q, _v, emit) => { emit([{ item: row, score: 1 }]); }).mockImplementationOnce(pending);
 it('retains search matches during same query refresh', async () => {
 fixture.platform.searchLibraryItems = searcher(); await render(<Search version={1} />); expect(current.filteredItems).toEqual([row]); await render(<Search version={2} />); expect(current.filteredItems).toEqual([row]);
 });
 it('clears search matches when query changes', async () => {
 fixture.platform.searchLibraryItems = searcher(); await render(<Search version={1} />); await render(<Search version={1} query="banana" />); expect(current.filteredItems).toEqual([]);
 });
});
