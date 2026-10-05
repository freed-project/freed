/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ state: {} as any, platform: {} as any, options: {} as any, display: {} as any, setDisplay: vi.fn(), searchCurrent: true, mark: vi.fn(), scopeCount: 0, socialCurrent: true }));
vi.mock('../../context/PlatformContext.js', () => ({ usePlatform: () => fixture.platform, useAppStore: (select: any) => select(fixture.state), usePlatformCapabilities: () => ({ libraryEdits: true, createPerson: true, changeCare: true }) }));
vi.mock('../../hooks/useLibraryCommandPaletteReader.js', () => ({ useLibraryCommandPaletteReader: () => ({ tags: [], selectedItem: null, archivedUnsavedCount: 0, savedArchivedCount: 0, unreadScopeCount: fixture.scopeCount, archivableScopeCount: 0, markScopeRead: fixture.mark }) }));
vi.mock('../../hooks/useLibraryRssFeedPage.js', () => ({ useLibraryRssFeedPage: () => ({ feeds: [] }) }));
vi.mock('../../hooks/useLibrarySocialChannelPage.js', () => ({ useLibrarySocialChannelPage: () => ({ channels: [], isAccountCurrent: () => fixture.socialCurrent }) }));
vi.mock('../../hooks/useSearchResults.js', () => ({ useSearchResults: () => ({ filteredItems: [], resultsCurrent: fixture.searchCurrent }) }));
vi.mock('../../lib/device-display-preferences.js', () => ({ useDeviceDisplayPreferences: () => [fixture.display, fixture.setDisplay] }));
vi.mock('../../lib/command-palette-registry.js', () => ({ buildCommandPaletteActions: (options: any) => { fixture.options = options; return []; } }));
import { SearchJumpField } from './SearchJumpField';
const profile = { id: 'social:x:original', kind: 'social', provider: 'x', externalId: 'original', displayName: 'Original Author', firstSeenAt: 1, lastSeenAt: 1, createdAt: 1, updatedAt: 1, discoveredFrom: 'captured_item' };
describe('profile Map navigation does not create relationships', () => {
 let host: HTMLDivElement, root: Root;
 beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.socialCurrent = true; fixture.scopeCount = 0; fixture.searchCurrent = true; fixture.mark.mockClear(); fixture.setDisplay.mockClear(); fixture.display = { mapMode: 'friends', friendsMode: 'friends' };
  fixture.state = { activeView: 'feed', activeFilter: {}, searchQuery: '', searchCorpusVersion: 1, selectedItemId: null,
   setSearchQuery: vi.fn(), setFilter: vi.fn(), setActiveView: vi.fn(), setSelectedItem: vi.fn(), setSelectedPerson: vi.fn(), setSelectedAccount: vi.fn() };
  fixture.platform = { readLibraryAccountDetail: vi.fn(async () => profile), readLibraryPersonDetail: vi.fn(async () => null), replaceLibraryFriend: vi.fn(), upsertLibraryPerson: vi.fn() };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<SearchJumpField />));
 });
 afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
 it('selects an unlinked content author for the all-content map without a Connection write', async () => {
  await act(async () => fixture.options.navigateToSocialProfileMap(profile, null));
  expect(fixture.platform.replaceLibraryFriend).not.toHaveBeenCalled();
  expect(fixture.platform.upsertLibraryPerson).not.toHaveBeenCalled();
  expect(fixture.platform.readLibraryAccountDetail).not.toHaveBeenCalled();
  expect(fixture.state.setSelectedPerson).toHaveBeenCalledWith(null);
  expect(fixture.state.setSelectedAccount).toHaveBeenCalledWith(profile.id);
  expect(fixture.setDisplay).toHaveBeenCalledWith({ mapMode: 'all_content' });
  expect(fixture.state.setActiveView).toHaveBeenCalledWith('map');
 });
 it('offers the read-only Map action without Person-creation capability', async () => {
  const actual = await vi.importActual<typeof import('../../lib/command-palette-registry.js')>('../../lib/command-palette-registry.js');
  const actions = actual.buildCommandPaletteActions({ ...fixture.options, query: 'original', allowPersonCreation: false, socialChannels: [{ account: profile }] });
  const action = actions.find(action => action.id === `go-profile-map-${profile.id}`);
  expect(action).toBeDefined();
  await act(async () => action!.run());
  expect(fixture.platform.replaceLibraryFriend).not.toHaveBeenCalled();
  expect(fixture.state.setSelectedAccount).toHaveBeenCalledWith(profile.id);
 });
 it('selects an already linked Person and clears stale Account selection without writes', async () => {
  await act(async () => fixture.options.navigateToSocialProfileMap(profile, 'person-existing'));
  expect(fixture.platform.replaceLibraryFriend).not.toHaveBeenCalled();
  expect(fixture.state.setSelectedPerson).toHaveBeenCalledWith('person-existing');
  expect(fixture.state.setSelectedAccount).toHaveBeenCalledWith(null);
  expect(fixture.state.setActiveView).toHaveBeenCalledWith('map');
 });
 it('rejects a captured search bulk command while refreshed results are pending', async () => {
  fixture.state.searchQuery = 'apple'; fixture.scopeCount = 3;
  await act(async () => root.render(<SearchJumpField key="search" />));
  const admitted = fixture.options.markScopeRead; expect(admitted).toBeTypeOf('function');
  await admitted(); expect(fixture.mark).toHaveBeenCalledOnce();
  fixture.searchCurrent = false;
  await act(async () => root.render(<SearchJumpField key="search" />));
  expect(fixture.options.markScopeRead).toBeNull();
  await admitted(); expect(fixture.mark).toHaveBeenCalledOnce();
 });

 it('rejects captured social navigation after destination admission changes', async () => {
  const map = fixture.options.navigateToSocialProfileMap;
  const friends = fixture.options.navigateToSocialProfileFriends;
  fixture.socialCurrent = false;
  await act(async () => root.render(<SearchJumpField />));
  await act(async () => { map(profile, null); friends(profile, 'person-existing'); });
  expect(fixture.state.setActiveView).not.toHaveBeenCalled();
  expect(fixture.state.setSelectedAccount).not.toHaveBeenCalled();
  expect(fixture.state.setSelectedPerson).not.toHaveBeenCalled();
 });

});
