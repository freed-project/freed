/** @vitest-environment jsdom */
// Actual 402 Header and real facet/scope/item-detail hooks. Synthetic readers;
// unrelated search/signal/theme leaves mocked. No native pixel/GPU claim.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPreferences, type FeedItem } from '@freed/shared';
import type { LibraryFacetSummary } from '../../context/PlatformContext.js';
const fixture = vi.hoisted(() => ({ store: {} as any, platform: {} as any }));
vi.mock('../../context/PlatformContext.js', () => ({
 useAppStore: (select: any) => select(fixture.store), usePlatform: () => fixture.platform,
 usePlatformCapabilities: () => ({ libraryEdits: true, createPerson: true, changeCare: true }), MACOS_TRAFFIC_LIGHT_INSET: 80,
}));
vi.mock('../../hooks/useIsMobile.js', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/useIsMobileDevice.js', () => ({ useIsMobileDevice: () => false }));
vi.mock('../../hooks/useSearchResults.js', () => ({ useSearchResults: () => ({ filteredItems: [], isSearching: false, resultCount: 0, searchUnavailable: false }) }));
vi.mock('../../hooks/useFeedSignalCounts.js', () => ({ useFeedSignalCounts: () => ({ all: 3, inspiring: 0, events: 0, personal: 0, conversation: 0, news: 0 }) }));
vi.mock('../../lib/device-display-preferences.js', () => ({ useDeviceDisplayPreferences: () => [{ friendsMode: 'all_content', mapMode: 'all_content', sidebarMode: 'expanded', feedSignalModes: [], dualColumnMode: false, savedContentSortMode: 'date_saved' }, vi.fn()] }));
vi.mock('../../lib/theme.js', () => ({ useThemePreference: () => ['dark', vi.fn()], applyThemeToDocument: vi.fn(), useThemePreviewController: () => ({ commitTheme: vi.fn(), previewTheme: vi.fn(), revertPreview: vi.fn() }) }));
vi.mock('../ThemePreviewButton.js', () => ({ ThemePreviewButton: () => null }));
vi.mock('../Tooltip.js', () => ({ Tooltip: ({ children }: any) => children }));
vi.mock('../BackgroundActivityPopover.js', () => ({ BackgroundActivityPopover: () => null }));
import { Header } from './Header.js';
import { useLibraryCommandPaletteReader } from '../../hooks/useLibraryCommandPaletteReader.js';
function summary(): LibraryFacetSummary {
 return { archivedCount: 0, archivableCount: 2, contactAccountCount: 0, contactLinkedPersonCount: 0,
  enabledRssFeedCount: 1, friendPersonCount: 0, latestContactImportedAt: null, latestRssFeedFetchedAt: null,
  platformCounts: [{ platform: 'facebook', unreadCount: 3, archivableCount: 2, totalCount: 5, latestCapturedAt: 1, latestPublishedAt: 1 }], rssFeedCount: 1, sampleAccountCount: 0, sampleFeedCount: 0, savedArchivedCount: 0,
  savedCount: 3, savedPlatformCount: 1, socialAccountCount: 0, sampleItemCount: 0, samplePersonCount: 0,
  tags: [], totalCount: 5, unreadCount: 3 };
}
function item(id: string, read = false): FeedItem {
 return { globalId: id, platform: 'rss', contentType: 'article', publishedAt: 1, capturedAt: 1,
  author: { id: 'synthetic', handle: 'synthetic', displayName: 'Synthetic' },
  content: { text: `Synthetic ${id}`, mediaUrls: [], mediaTypes: [] }, topics: [],
  userState: { saved: false, archived: false, hidden: false, tags: [], ...(read ? { readAt: 1 } : {}) } };
}
function reader(pending?: Promise<FeedItem[]>) {
 let calls = 0;
 return { totalCount: 2, close: vi.fn(async () => {}), readNext: async () => calls++ === 0 ? (pending ?? [item('unread'), item('read', true)]) : [] };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void;
 const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
describe('Header same-context background refresh', () => {
 let host: HTMLDivElement, root: Root;
 beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('innerWidth', 1440);
  fixture.store = { activeView: 'feed', activeFilter: {}, searchQuery: '', searchCorpusVersion: 1, libraryItemVersion: 1,
   isInitialized: true, selectedItemId: null, visibleFeedTotalCount: 5, pendingMatchCount: 0,
   mapFriendLocationCount: 0, mapAllContentLocationCount: 0, preferences: createDefaultPreferences(),
   unarchiveSavedItems: vi.fn(), deleteAllArchived: vi.fn(), toggleSaved: vi.fn(), toggleArchived: vi.fn(),
   updatePreferences: vi.fn(), setSelectedItem: vi.fn(), setFilter: vi.fn() };
  fixture.platform = { readLibraryFacetSummary: vi.fn(async () => summary()), openBoundedFeedReader: vi.fn(async () => reader()),
   store: { getState: () => fixture.store }, readLibraryItemDetail: vi.fn(async (id: string) => item(id)), executeLibraryScopeAction: vi.fn(async () => {}) };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 });
 afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
 const render = async () => { await act(async () => root.render(<Header mobileSidebarOpen={false} onMobileMenuToggle={() => {}}
  desktopSidebarMode="expanded" onDesktopSidebarToggle={() => {}} friendsSidebarOpen={false} onFriendsSidebarToggle={() => {}}
  friendsMobileSurface="graph" onFriendsMobileSurfaceChange={() => {}} />)); };
 const actions = () => host.querySelector('[data-testid="toolbar-overflow-button"]');
 it('keeps the top More actions button mounted while same-scope facet counts refresh', async () => {
  await render(); const button = actions(); expect(button).not.toBeNull();
  const pending = deferred<LibraryFacetSummary>(); fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
  fixture.store.libraryItemVersion++; fixture.store.searchCorpusVersion++; await render();
  // Retention is a presentation contract; this test does not assert stale actions remain enabled.
  const during = actions();
  await act(async () => pending.resolve(summary()));
  expect({ retainedDuringRefresh: during === button, retainedAfterRefresh: actions() === button }).toEqual({ retainedDuringRefresh: true, retainedAfterRefresh: true });
 });
 it('keeps the top More actions button mounted while the same complex scope rescans', async () => {
  fixture.store.activeFilter = { authorId: 'synthetic', platform: 'rss' };
  await render(); const button = actions(); expect(button).not.toBeNull();
  const pending = deferred<FeedItem[]>(); fixture.platform.openBoundedFeedReader.mockResolvedValueOnce(reader(pending.promise));
  fixture.store.libraryItemVersion++; await render();
  const during = actions();
  await act(async () => pending.resolve([item('unread'), item('read', true)]));
  expect({ retainedDuringRefresh: during === button, retainedAfterRefresh: actions() === button }).toEqual({ retainedDuringRefresh: true, retainedAfterRefresh: true });
 });
 it('retains the same selected-item toolbar during refresh but clears it on selection change', async () => {
  fixture.store.selectedItemId = 'A'; await render();
  const button = host.querySelector('button[aria-label="Save"]'); expect(button).not.toBeNull();
  const pending = deferred<FeedItem | null>(); fixture.platform.readLibraryItemDetail.mockReturnValueOnce(pending.promise);
  fixture.store.libraryItemVersion++; await render();
  expect(host.querySelector('button[aria-label="Save"]')).toBe(button);
  const next = deferred<FeedItem | null>(); fixture.platform.readLibraryItemDetail.mockReturnValueOnce(next.promise);
  fixture.store.selectedItemId = 'B'; await render();
  expect(host.querySelector('button[aria-label="Save"]')).toBeNull();
  expect(host.querySelector('[data-testid="workspace-toolbar-reader-detail-status"]')).not.toBeNull();
  await act(async () => { pending.resolve(item('A')); next.resolve(item('B')); });
 });
 it('clears old scope actions on a context change and surfaces no old action after a failed read', async () => {
  await render(); expect(actions()).not.toBeNull();
  const pending = deferred<FeedItem[]>(); fixture.platform.openBoundedFeedReader.mockResolvedValueOnce(reader(pending.promise));
  fixture.store.activeFilter = { authorId: 'new-author', platform: 'rss' }; await render();
  expect(actions()).toBeNull();
  await act(async () => pending.reject(new Error('synthetic scope failure')));
  expect(actions()).toBeNull();
 });
 for (const complex of [false, true]) {
  it(`keeps an open menu inert through overlapping ${complex ? 'scope' : 'facet'} refreshes and ignores stale replies`, async () => {
   if (complex) fixture.store.activeFilter = { authorId: 'synthetic', platform: 'rss' };
   await render();
   await act(async () => (actions() as HTMLButtonElement).click());
   const menu = host.querySelector('[role="menu"]'); expect(menu).not.toBeNull();
   const old = deferred<any>(), current = deferred<any>();
   const queue = (pending: ReturnType<typeof deferred<any>>) => complex
    ? fixture.platform.openBoundedFeedReader.mockResolvedValueOnce(reader(pending.promise))
    : fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
   queue(old); fixture.store.libraryItemVersion++; fixture.store.searchCorpusVersion++; await render();
   queue(current); fixture.store.libraryItemVersion++; fixture.store.searchCorpusVersion++; await render();
   expect(host.querySelector('[role="menu"]')).toBe(menu);
   const mark = host.querySelector('[role="menuitem"]') as HTMLButtonElement;
   expect(mark.disabled).toBe(true);
   await act(async () => { mark.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); mark.click(); });
   expect(fixture.platform.executeLibraryScopeAction).not.toHaveBeenCalled();
   await act(async () => current.resolve(complex ? [item('new')] : { ...summary(), unreadCount: 1, archivableCount: 0 }));
   expect(mark.disabled).toBe(false); expect(mark.textContent).toContain('1 unread');
   await act(async () => old.resolve(complex ? [item('old'), item('older')] : summary()));
   expect(mark.textContent).toContain('1 unread');
   await act(async () => mark.click());
   expect(fixture.platform.executeLibraryScopeAction).toHaveBeenCalledOnce();
  });
  for (const outcome of ['zero', 'error']) it(`clears ${complex ? 'scope' : 'facet'} actions after settled ${outcome}`, async () => {
   if (complex) fixture.store.activeFilter = { authorId: 'synthetic', platform: 'rss' };
   await render(); expect(actions()).not.toBeNull();
   const pending = deferred<any>();
   if (complex) fixture.platform.openBoundedFeedReader.mockResolvedValueOnce(reader(pending.promise));
   else fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
   fixture.store.libraryItemVersion++; fixture.store.searchCorpusVersion++; await render();
   expect(actions()).not.toBeNull();
   await act(async () => outcome === 'error' ? pending.reject(new Error('synthetic'))
    : pending.resolve(complex ? [] : { ...summary(), unreadCount: 0, archivableCount: 0 }));
   expect(actions()).toBeNull();
  });
 }

 it('rejects captured command callbacks during refresh, after scope replacement, and after zero/error results', async () => {
  let latest!: ReturnType<typeof useLibraryCommandPaletteReader>;
  function Probe() {
   latest = useLibraryCommandPaletteReader({ activeFilter: fixture.store.activeFilter, activeView: 'feed', commandScopeItems: [], enabled: true,
    identityMode: 'all_content', inputValue: '', searchQuery: '', selectedItemId: null, sourceVersion: fixture.store.libraryItemVersion });
   return null;
  }
  const probe = async () => { await act(async () => root.render(<Probe />)); };
  await probe(); const captured = latest.markScopeRead;
  const pending = deferred<LibraryFacetSummary>(); fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
  fixture.store.libraryItemVersion++; await probe();
  await captured(); await latest.markScopeRead(); expect(fixture.platform.executeLibraryScopeAction).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ ...summary(), unreadCount: 0, archivableCount: 0 }));
  await latest.markScopeRead(); expect(fixture.platform.executeLibraryScopeAction).not.toHaveBeenCalled();
  const next = deferred<FeedItem[]>(); fixture.platform.openBoundedFeedReader.mockResolvedValueOnce(reader(next.promise));
  fixture.store.activeFilter = { authorId: 'replacement', platform: 'rss' }; await probe();
  await captured(); expect(fixture.platform.executeLibraryScopeAction).not.toHaveBeenCalled();
  await act(async () => next.reject(new Error('synthetic')));
  await latest.markScopeRead(); expect(fixture.platform.executeLibraryScopeAction).not.toHaveBeenCalled();
 });

 it('does not adopt a prior compact scope presentation when the filter changes during refresh', async () => {
  await render(); expect(actions()).not.toBeNull();
  const pending = deferred<LibraryFacetSummary>(); fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
  fixture.store.libraryItemVersion++; fixture.store.searchCorpusVersion++; await render();
  expect(actions()).not.toBeNull();
  fixture.store.activeFilter = { platform: 'facebook' }; await render(); expect(actions()).toBeNull();
  await act(async () => pending.resolve(summary())); expect(actions()).not.toBeNull();
 });

 it('retains the inline archived count action but admits it only after the current facet read', async () => {
  fixture.platform.readLibraryFacetSummary.mockResolvedValue({ ...summary(), savedArchivedCount: 3 });
  fixture.store.activeFilter = { archivedOnly: true }; await render();
  const button = Array.from(host.querySelectorAll('button')).find(node => node.textContent?.includes('Unarchive saved'))!;
  expect(button).not.toBeUndefined();
  const pending = deferred<LibraryFacetSummary>(); fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
  fixture.store.searchCorpusVersion++; fixture.store.libraryItemVersion++; await render();
  expect(button.disabled).toBe(true); await act(async () => button.click());
  expect(fixture.store.unarchiveSavedItems).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ ...summary(), savedArchivedCount: 3 })); expect(button.disabled).toBe(false);
  await act(async () => button.click()); expect(fixture.store.unarchiveSavedItems).toHaveBeenCalledOnce();
 });

});
