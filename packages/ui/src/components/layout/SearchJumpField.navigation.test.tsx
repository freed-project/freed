/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ state: {} as any, platform: {} as any, options: {} as any, display: {} as any, setDisplay: vi.fn() }));
vi.mock('../../context/PlatformContext.js', () => ({ usePlatform: () => fixture.platform, useAppStore: (select: any) => select(fixture.state), usePlatformCapabilities: () => ({ libraryEdits: true, createPerson: true, changeCare: true }) }));
vi.mock('../../hooks/useLibraryCommandPaletteReader.js', () => ({ useLibraryCommandPaletteReader: () => ({ tags: [], selectedItem: null, archivedUnsavedCount: 0, savedArchivedCount: 0, unreadScopeCount: 0, archivableScopeCount: 0 }) }));
vi.mock('../../hooks/useLibraryRssFeedPage.js', () => ({ useLibraryRssFeedPage: () => ({ feeds: [] }) }));
vi.mock('../../hooks/useLibrarySocialChannelPage.js', () => ({ useLibrarySocialChannelPage: () => ({ channels: [] }) }));
vi.mock('../../hooks/useSearchResults.js', () => ({ useSearchResults: () => ({ filteredItems: [] }) }));
vi.mock('../../lib/device-display-preferences.js', () => ({ useDeviceDisplayPreferences: () => [fixture.display, fixture.setDisplay] }));
vi.mock('../../lib/command-palette-registry.js', () => ({ buildCommandPaletteActions: (options: any) => { fixture.options = options; return []; } }));
import { SearchJumpField } from './SearchJumpField';
const profile = { id: 'social:x:original', kind: 'social', provider: 'x', externalId: 'original', displayName: 'Original Author', firstSeenAt: 1, lastSeenAt: 1, createdAt: 1, updatedAt: 1, discoveredFrom: 'captured_item' };
describe('profile Map navigation does not create relationships', () => {
 let host: HTMLDivElement, root: Root;
 beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.setDisplay.mockClear(); fixture.display = { mapMode: 'friends', friendsMode: 'friends' };
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
});
