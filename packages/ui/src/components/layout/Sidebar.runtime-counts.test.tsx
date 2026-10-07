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
  it('uses one runtime receipt with no duplicate reads and no count slot churn', async () => {
    let state: any = { status: 'ready', committed: { facets: summary(), rss }, activation: 1, attempts: 1, error: null };
    const listeners = new Set<() => void>();
    fixture.platform.libraryCountResource = { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
    const publish = async (next: any) => act(async () => { state = next; listeners.forEach(listener => listener()); });
    await render(); const nodes = sourceSlots(), saved = labelSlot('Saved'), friends = labelSlot('Friends');
    expect(nodes.every(Boolean)).toBe(true);
    for (let i = 0; i < 20; i++) {
      await publish({ ...state, status: 'refreshing' });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(sourceSlots()).toEqual(nodes); expect(labelSlot('Saved')).toBe(saved); expect(labelSlot('Friends')).toBe(friends);
      await publish({ ...state, status: 'ready', committed: { facets: summary(22355 + i), rss } });
    }
    expect(fixture.platform.readLibraryFacetSummary).not.toHaveBeenCalled(); expect(fixture.platform.queryLibraryCore).not.toHaveBeenCalled();
    await publish({ ...state, status: 'error', error: 'query' });
    expect(sourceSlots()).toEqual(nodes);
    expect(host.querySelector('[data-library-facets-status]')?.getAttribute('data-library-facets-status')).toBe('error');
    await publish({ ...state, status: 'unavailable', committed: null, activation: 2 });
    expect(sourceSlots().every(node => node === null)).toBe(true);
  });
});
