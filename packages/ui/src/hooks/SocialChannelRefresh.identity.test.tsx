/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ platform: {} as any }));
vi.mock("../context/PlatformContext.js", () => ({ usePlatform: () => fixture.platform }));
import { useLibrarySocialChannelPage } from "./useLibrarySocialChannelPage.js";
let root: Root, current: any, seen: any[];
const row = { id: "synthetic-a", kind: "social", provider: "youtube", externalId: "alpha", displayName: "Alpha", personId: null };
function Probe({ query, version = 1 }: { query: string; version?: number }) {
 current = useLibrarySocialChannelPage({ enabled: true, query, sourceVersion: version });
 seen.push(current.channels); return null;
}
async function render(query: string, version = 1) { await act(async () => root.render(<Probe query={query} version={version} />)); }
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 seen = []; root = createRoot(document.createElement("div"));
 fixture.platform = { queryLibraryCore: vi.fn(async () => ({ rows: [row], nextCursor: null })) };
});
afterEach(async () => { await act(async () => root.unmount()); });
it("does not expose old social destinations in the first render of a changed query", async () => {
 await render("alpha"); expect(current.channels).toHaveLength(1);
 fixture.platform.queryLibraryCore.mockImplementation(() => new Promise(() => {}));
 seen = []; await render("beta");
 expect(seen[0]).toEqual([]); expect(current.channels).toEqual([]);
});
it("does not expose old social destinations after an equal-version reader replacement", async () => {
 await render("alpha"); expect(current.channels).toHaveLength(1);
 fixture.platform.queryLibraryCore = vi.fn(() => new Promise(() => {}));
 seen = []; await render("alpha");
 expect(seen[0]).toEqual([]); expect(current.channels).toEqual([]);
});

function deferred() { let resolve!: (value: any) => void; let reject!: (reason: Error) => void; const promise = new Promise<any>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
it("retains same-context presentation but rejects captured accounts during refresh and after replacement", async () => {
 await render("alpha"); const account = current.channels[0].account; const admit = current.isAccountCurrent;
 expect(admit(account)).toBe(true);
 const pending = deferred(); fixture.platform.queryLibraryCore.mockReturnValueOnce(pending.promise);
 await render("alpha", 2); expect(current.channels[0].account).toBe(account); expect(current.loading).toBe(true); expect(admit(account)).toBe(false);
 await act(async () => pending.resolve({ rows: [row], nextCursor: null }));
 expect(current.resultsCurrent).toBe(true); expect(admit(account)).toBe(false); expect(admit(current.channels[0].account)).toBe(true);
});
it("ignores out-of-order completion and applies real empty results", async () => {
 await render("alpha"); const old = deferred(), latest = deferred();
 fixture.platform.queryLibraryCore.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
 await render("alpha", 2); await render("alpha", 3);
 await act(async () => latest.resolve({ rows: [], nextCursor: null })); expect(current.channels).toEqual([]); expect(current.resultsCurrent).toBe(true);
 await act(async () => old.resolve({ rows: [row], nextCursor: null })); expect(current.channels).toEqual([]);
});
it("clears errors and does not resurrect failed rows while retrying", async () => {
 await render("alpha"); const pending = deferred(); fixture.platform.queryLibraryCore.mockReturnValueOnce(pending.promise); await render("alpha", 2);
 await act(async () => pending.reject(new Error("synthetic failure"))); expect(current.channels).toEqual([]); expect(current.error).toBe("synthetic failure"); expect(current.resultsCurrent).toBe(false);
 const retry = deferred(); fixture.platform.queryLibraryCore.mockReturnValueOnce(retry.promise); await render("alpha", 3); expect(current.channels).toEqual([]);
 await act(async () => retry.resolve({ rows: [row], nextCursor: null })); expect(current.channels).toHaveLength(1); expect(current.error).toBeNull();
});
it("does not restart equivalent normalized terms and fences Person-reader replacement and rewind", async () => {
 await render("alpha", 5); await render("  ALPHA  ", 5); expect(fixture.platform.queryLibraryCore).toHaveBeenCalledOnce();
 fixture.platform.readLibraryPersonDetail = vi.fn(async () => null);
 fixture.platform.queryLibraryCore.mockImplementation(() => new Promise(() => {}));
 seen=[]; await render("alpha", 5); expect(seen[0]).toEqual([]);
 seen=[]; await render("alpha", 1); expect(seen[0]).toEqual([]);
});
