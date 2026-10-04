/**
 * @vitest-environment jsdom
 * Actual Sidebar + facet/RSS hooks. DOM count-slot stability models the observed
 * AX disappearance/restoration; it is not proof of a native GPU paint flash.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPreferences } from '@freed/shared';
import type { LibraryFacetSummary } from '../../context/PlatformContext';
const fixture = vi.hoisted(() => ({ store: {} as any, platform: {} as any }));
vi.mock('../../context/PlatformContext.js', () => ({ useAppStore: (select: any) => select(fixture.store), usePlatform: () => fixture.platform, usePlatformCapabilities: () => ({ diagnostics: false }) }));
vi.mock('../../hooks/useIsMobile.js', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/useLibraryRssFeedPage.js', () => ({ useLibraryRssFeedPage: () => ({ feeds: [], rows: [], totalCount: 0, hasNext: false, hasPrevious: false, loading: false }) }));
vi.mock('../SettingsDialog.js', () => ({ SettingsDialog: () => null }));
vi.mock('../Tooltip.js', () => ({ Tooltip: ({ children }: any) => children }));
vi.mock('../ProviderStatusIndicator.js', () => ({ ProviderStatusIndicator: () => null }));
vi.mock('./SearchJumpField.js', () => ({ SearchJumpField: () => null }));
import { Sidebar } from './Sidebar';
const summary = (totalCount = 22_354): LibraryFacetSummary => ({
  archivedCount: 100, archivableCount: 0, contactAccountCount: 0, contactLinkedPersonCount: 0,
  enabledRssFeedCount: 1, friendPersonCount: 6, latestContactImportedAt: null, latestRssFeedFetchedAt: null,
  platformCounts: ['x', 'facebook', 'instagram', 'linkedin', 'medium'].map(platform => ({ platform, totalCount: 1000, unreadCount: 500, archivableCount: 0, latestCapturedAt: null, latestPublishedAt: null })),
  rssFeedCount: 1, sampleAccountCount: 0, sampleFeedCount: 0, savedArchivedCount: 0, savedCount: 50,
  savedPlatformCount: 5, socialAccountCount: 100, sampleItemCount: 0, samplePersonCount: 0, tags: [], totalCount, unreadCount: 10_000,
});
const rss = { queryId: "rss_item_summary_v1" as const, schemaVersion: 1 as const, source: { generationId: "a".repeat(64), projectionRevision: 1, transitionSequence: 1 }, totalCount: 500, unreadCount: 250 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('sidebar count-slot refresh acceptance', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers();
    fixture.store = { activeFilter: {}, searchQuery: '', activeView: 'map', searchCorpusVersion: 1, selectedItemId: null,
      preferences: createDefaultPreferences(), pendingMatchCount: 99, mapFriendLocationCount: 0, mapAllContentLocationCount: 25,
      setFilter: vi.fn(), setSelectedItem: vi.fn(), setSelectedPerson: vi.fn(), setSearchQuery: vi.fn(), setActiveView: vi.fn() };
    fixture.platform = { interactionMode: 'read-only', readLibraryFacetSummary: vi.fn(async () => summary()), queryLibraryCore: vi.fn(async () => rss) };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const render = async () => act(async () => root.render(<Sidebar mobileOpen={false} onMobileClose={() => {}} desktopMode="expanded" onDesktopModeChange={() => {}} />));
  const sourceSlots = () => ['all', 'rss', 'x', 'facebook', 'instagram', 'linkedin', 'medium'].map(id => host.querySelector(`[data-testid="source-counts-${id}"]`));
  const labelSlot = (label: string) => [...host.querySelectorAll('li')].find(row => row.textContent?.includes(label))?.querySelector('[data-sidebar-count-slot]');
  it('retains populated count slots while a new facet/RSS snapshot is pending', async () => {
    await render(); const sourceNodes = sourceSlots();
    expect(sourceNodes.every(Boolean)).toBe(true);
    const saved = labelSlot('Saved'), friends = labelSlot('Friends'), map = labelSlot('Map');
    expect(saved?.textContent).toContain('50'); expect(friends?.textContent).toContain('6'); expect(map?.textContent).toContain('25');
    const facets = deferred<LibraryFacetSummary>(), rssRows = deferred<typeof rss>();
    fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(facets.promise);
    fixture.platform.queryLibraryCore.mockReturnValueOnce(rssRows.promise);
    fixture.store.searchCorpusVersion = 2; await render();
    // Native observed a five-second gap: simulate it without wall-clock sleeps.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    // No failure and no user input.
    expect(sourceSlots()).toEqual(sourceNodes);
    expect(labelSlot('Saved')).toBe(saved); expect(labelSlot('Friends')).toBe(friends); expect(friends?.textContent).toContain('6'); expect(labelSlot('Map')).toBe(map);
    await act(async () => { facets.resolve(summary(22_355)); rssRows.resolve(rss); });
    expect(sourceSlots()).toEqual(sourceNodes);
  });
  it('preserves count DOM identity through repeated deferred background revisions', async () => {
    await render(); const nodes = sourceSlots(), map = labelSlot('Map'); let disappearances = 0, missingSavedOrFriendCount = 0;
    for (let version = 2; version <= 21; version++) {
      const replacement = deferred<LibraryFacetSummary>(), rssRows = deferred<typeof rss>();
      fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(replacement.promise); fixture.platform.queryLibraryCore.mockReturnValueOnce(rssRows.promise);
      fixture.store.searchCorpusVersion = version; await render();
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      disappearances += sourceSlots().filter((node, index) => node !== nodes[index]).length;
      if (!labelSlot('Saved') || !labelSlot('Friends')?.textContent?.includes('6')) missingSavedOrFriendCount++;
      expect(labelSlot('Map')).toBe(map);
      await act(async () => { replacement.resolve(summary(22_354 + version)); rssRows.resolve(rss); await vi.advanceTimersByTimeAsync(250); });
    }
    expect({ disappearances, missingSavedOrFriendCount }).toEqual({ disappearances: 0, missingSavedOrFriendCount: 0 });
  });
  it('applies a genuine completed zero snapshot instead of retaining stale counts forever', async () => {
    await render();
    fixture.platform.readLibraryFacetSummary.mockResolvedValueOnce({ ...summary(0), platformCounts: [], savedCount: 0, friendPersonCount: 0, unreadCount: 0 });
    fixture.platform.queryLibraryCore.mockResolvedValueOnce({ ...rss, totalCount: 0, unreadCount: 0 });
    fixture.store.searchCorpusVersion = 2; await render();
    expect(sourceSlots().every(slot => slot === null)).toBe(true); expect(labelSlot('Saved')).toBeNull();
    expect(labelSlot('Friends')?.textContent).not.toContain('6');
  });
  it('does not display previous-reader counts for a new reader at the same revision', async () => {
    await render(); const next = deferred<LibraryFacetSummary>(), rssRows = deferred<typeof rss>();
    fixture.platform.readLibraryFacetSummary = vi.fn(() => next.promise);
    fixture.platform.queryLibraryCore = vi.fn(() => rssRows.promise);
    await render();
    expect(sourceSlots().every(slot => slot === null)).toBe(true);
    await act(async () => { next.resolve(summary(3)); rssRows.resolve({ ...rss, totalCount: 3 }); });
    expect(host.querySelector('[data-testid="source-counts-all"]')?.textContent).toContain('3');
  });
  it('does not treat a failed refresh as a successfully current count snapshot', async () => {
    await render();
    fixture.platform.readLibraryFacetSummary.mockRejectedValueOnce(new Error('synthetic query failure'));
    fixture.platform.queryLibraryCore.mockRejectedValueOnce(new Error('synthetic RSS failure'));
    fixture.store.searchCorpusVersion = 2; await render();
    // Existing API exposes unavailable as empty; a future status UI may improve it.
    expect(sourceSlots().every(slot => slot === null)).toBe(true);
    fixture.store.searchCorpusVersion = 3; await render();
    expect(sourceSlots().every(Boolean)).toBe(true);
  });
  it('ignores late obsolete count results after a newer snapshot wins', async () => {
    await render(); const old = deferred<LibraryFacetSummary>(), oldRss = deferred<typeof rss>();
    fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(old.promise);
    fixture.platform.queryLibraryCore.mockReturnValueOnce(oldRss.promise);
    fixture.store.searchCorpusVersion = 2; await render();
    fixture.platform.readLibraryFacetSummary.mockResolvedValueOnce({ ...summary(4), savedCount: 4 });
    fixture.platform.queryLibraryCore.mockResolvedValueOnce({ ...rss, totalCount: 4 });
    fixture.store.searchCorpusVersion = 3; await render();
    const latestText = host.querySelector('[data-testid="source-counts-all"]')?.textContent;
    await act(async () => { old.resolve(summary(99)); oldRss.resolve({ ...rss, totalCount: 99 }); });
    expect(host.querySelector('[data-testid="source-counts-all"]')?.textContent).toBe(latestText);
    expect(labelSlot('Saved')?.textContent).toBe('4');
  });

});
