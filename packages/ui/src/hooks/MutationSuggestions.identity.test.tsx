/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ platform: {} as any }));
vi.mock('../context/PlatformContext.js', () => ({ usePlatform: () => fixture.platform }));
import { useLibraryPersonPicker } from './useLibraryPersonPicker.js';
import { useLibraryAccountLinkCandidates } from './useLibraryAccountLinkCandidates.js';
import { useLibraryFriendCandidateReview } from './useLibraryFriendCandidateReview.js';
const row = { id: 'synthetic', accountIdsJson: '[]', sampleItemIdsJson: '[]', signalCountsJson: '{}', personId: 'person-a', accountId: 'account-a' };
const empty: any[] = [];
const cases = [
 { name: 'picker', hook: () => useLibraryPersonPicker({ enabled: true, query: fixture.platform.queryLibraryCore, search: '', sourceVersion: 1 }).rows },
 { name: 'account candidates', hook: () => useLibraryAccountLinkCandidates({ entityId: 'account-a', entityKind: 'account', sourceVersion: 1 }) },
 { name: 'Friend review', hook: () => useLibraryFriendCandidateReview({ contactSuggestions: empty, dismissedSuggestionIds: empty, sourceVersion: 1 }) },
];
let root: Root, seen: any[], current: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root=createRoot(document.createElement('div')); seen=[]; fixture.platform={queryLibraryCore: vi.fn(async () => ({ rows: [row] }))}; });
afterEach(async () => { await act(async () => root.unmount()); });
for (const c of cases) it(`${c.name} fences an equal-version reader replacement before effects`, async () => {
 function Probe() { current=c.hook(); seen.push(current); return null; }
 await act(async () => root.render(<Probe />)); expect(current).toHaveLength(1);
 fixture.platform.queryLibraryCore=vi.fn(() => new Promise(() => {})); seen=[];
 await act(async () => root.render(<Probe />)); expect(seen[0]).toEqual([]); expect(current).toEqual([]);
});
