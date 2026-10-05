/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ platform: {} as any, store: {} as any }));
vi.mock("../../context/PlatformContext.js", () => ({
  usePlatform: () => fixture.platform,
  useAppStore: (select: (state: any) => unknown) => select(fixture.store),
  usePlatformCapabilities: () => ({ libraryEdits: false }),
}));
vi.mock("../../context/ContactSyncContext.js", () => ({ useContactSyncContext: () => ({ suggestionPage: { rows: [] } }) }));
vi.mock("../../hooks/useIsMobile.js", () => ({ useIsMobile: () => false }));
vi.mock("../../lib/device-display-preferences.js", () => ({ useDeviceDisplayPreferences: () => [{ friendsMode: "friends" }, () => true] }));
vi.mock("../../lib/theme.js", () => ({ useAppliedThemeId: () => "light" }));
vi.mock("../../hooks/useLibraryIdentityDetail.js", () => ({
  useLibraryFriendDetail: () => ({ value: null }),
  useLibraryAccountDetail: () => ({ value: null }),
  useLibraryPersonDetail: () => ({ value: null }),
}));
vi.mock("../../hooks/useLibraryFacetSummary.js", () => ({ useLibraryFacetSummaryState: () => ({ summary: { friendPersonCount: 1, socialAccountCount: 1 } }) }));
vi.mock("../../hooks/useLibraryFriendsRows.js", () => ({ useLibraryFriendsRows: () => ({ graph: null, graphLoading: false, timelineItems: [], locationItems: [] }) }));
vi.mock("../../hooks/useLibraryAccountLinkCandidates.js", () => ({ useLibraryAccountLinkCandidatesState: () => ({ rows: [], resultsCurrent: true }) }));
vi.mock("../../hooks/useLibraryFriendCandidateReview.js", () => ({ useLibraryFriendCandidateReviewState: () => ({ rows: [], resultsCurrent: true }) }));
vi.mock("./FriendGraph.js", () => ({ FriendGraph: () => null }));
vi.mock("./FriendOverview.js", () => ({ FriendOverview: ({ name }: { name: string }) => <p>{name}</p> }));
vi.mock("./FriendDetailPanel.js", () => ({ FriendDetailPanel: () => null }));
vi.mock("./AccountDetailPanel.js", () => ({ AccountDetailPanel: () => null }));
vi.mock("./FriendEditor.js", () => ({ FriendEditor: () => null }));
vi.mock("./RssPlanetDetail.js", () => ({ RssPlanetDetail: () => null }));

import { FriendsView } from "./FriendsView.js";

const page = (name = "Synthetic friend") => ({ rows: [{ id: "synthetic-person", name }], totalCount: 1, nextCursor: null, source: null });
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.store = { searchCorpusVersion: 1, preferences: {}, pendingMatchCount: 0 };
  fixture.platform = { queryLibraryCore: vi.fn(async () => page()) };
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
async function render() {
  await act(async () => root.render(<FriendsView friendsSidebarOpen onFriendsSidebarOpenChange={() => {}} mobileSurface="graph" />));
}
async function query() { await act(async () => vi.advanceTimersByTimeAsync(150)); }
function sidebar() { return host.querySelector('[data-testid="friends-sidebar"]')!; }
function expectSpinner() {
  const loading = sidebar().querySelector('[data-testid="friends-activity-loading"]')!;
  expect(loading).not.toBeNull();
  expect(loading.querySelector('[role="status"] svg[aria-hidden="true"]')).not.toBeNull();
  expect(loading.querySelector("span")?.className).toBe("sr-only");
  expect(loading.className).not.toMatch(/theme-panel|border|rounded/);
  expect(sidebar().querySelector("h3")).toBeNull();
  expect(sidebar().textContent).not.toContain("Loading friend activity...");
}

it("shows only an accessible spinner until the initial directory commits, then restores the heading", async () => {
  await render(); expectSpinner();
  await query();
  expect(sidebar().querySelector('[data-testid="friends-activity-loading"]')).toBeNull();
  expect(sidebar().querySelector("h3")?.textContent).toBe("All friends");
  expect(sidebar().textContent).toContain("Synthetic friend");
});

it("retains committed activity and the heading during a same-context refresh", async () => {
  await render(); await query();
  const pending = deferred(); fixture.platform.queryLibraryCore.mockReturnValueOnce(pending.promise);
  fixture.store.searchCorpusVersion = 2; await render(); await query();
  expect(sidebar().textContent).toContain("Synthetic friend");
  expect(sidebar().querySelector("h3")?.textContent).toBe("All friends");
  expect(sidebar().querySelector('[data-testid="friends-activity-loading"]')).toBeNull();
  await act(async () => pending.resolve(page("Updated synthetic friend")));
  expect(sidebar().textContent).toContain("Updated synthetic friend");
});

it("hides the old directory and heading immediately on a sort change and restores the empty state after settlement", async () => {
  await render(); await query();
  const pending = deferred(); fixture.platform.queryLibraryCore.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const select = sidebar().querySelector("select")!;
    select.value = "name"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expectSpinner(); expect(sidebar().textContent).not.toContain("Synthetic friend");
  await query(); expectSpinner();
  await act(async () => pending.resolve({ ...page(), rows: [], totalCount: 0 }));
  expect(sidebar().querySelector("h3")?.textContent).toBe("All friends");
  expect(sidebar().textContent).toContain("No friends match those filters");
});

it("does not leave a spinner behind when the directory read fails", async () => {
  fixture.platform.queryLibraryCore.mockRejectedValueOnce(new Error("Synthetic failure"));
  await render(); expectSpinner(); await query();
  expect(sidebar().querySelector('[data-testid="friends-activity-loading"]')).toBeNull();
  expect(sidebar().textContent).toContain("No friends match those filters");
});
