/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryFacetSummary } from "../context/PlatformContext.js";
import { useLibraryFacetSummaryState, useLibraryRssItemSummaryState, useLibraryNavigationCounts } from "./useLibraryFacetSummary.js";
const fixture = vi.hoisted(() => ({ platform: {} as any }));
vi.mock("../context/PlatformContext.js", () => ({ usePlatform: () => fixture.platform }));
const summary = (totalCount: number) => ({ totalCount } as LibraryFacetSummary);
const rss = (totalCount: number) => ({ queryId: "rss_item_summary_v1", schemaVersion: 1, totalCount });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root, host: HTMLDivElement, current: any;
function Harness({ version, enabled = true }: { version: number; enabled?: boolean }) {
  current = { facets: useLibraryFacetSummaryState(version, enabled), rss: useLibraryRssItemSummaryState(version) };
  return null;
}
const render = async (version: number, enabled = true) => act(async () => root.render(<Harness version={version} enabled={enabled} />));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.platform = { readLibraryFacetSummary: vi.fn(async () => summary(10)), queryLibraryCore: vi.fn(async () => rss(4)) };
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("reports refreshing, error and recovered ready without mistaking pending work for zero", async () => {
  await render(1);
  const facets = deferred<LibraryFacetSummary>(), rows = deferred<any>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(facets.promise);
  fixture.platform.queryLibraryCore.mockReturnValueOnce(rows.promise);
  await render(2);
  expect(current.facets).toMatchObject({ status: "refreshing", summary: { totalCount: 10 } });
  expect(current.rss).toMatchObject({ status: "refreshing", summary: { totalCount: 4 } });
  await act(async () => { facets.reject(new Error("synthetic failure")); rows.reject(new Error("synthetic failure")); });
  expect(current.facets).toMatchObject({ status: "error", summary: { totalCount: 0 } });
  expect(current.rss).toEqual({ status: "error", summary: null });
  await render(3);
  expect(current.facets.status).toBe("ready"); expect(current.rss.status).toBe("ready");
});
it("clears a disabled facet scope and does not resurrect its pending completion", async () => {
  await render(1);
  const pending = deferred<LibraryFacetSummary>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
  await render(2); await render(2, false);
  await act(async () => pending.resolve(summary(99)));
  expect(current.facets).toMatchObject({ status: "unavailable", summary: { totalCount: 0 } });
  const fresh = deferred<LibraryFacetSummary>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(fresh.promise);
  await render(2);
  expect(current.facets).toMatchObject({ status: "loading", summary: { totalCount: 0 } });
  await act(async () => fresh.resolve(summary(3)));
  expect(current.facets.summary.totalCount).toBe(3);
});
it("clears on reader removal/logout and ignores prior in-flight success", async () => {
  await render(1);
  const pending = deferred<LibraryFacetSummary>(), rows = deferred<any>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(pending.promise);
  fixture.platform.queryLibraryCore.mockReturnValueOnce(rows.promise);
  await render(2);
  fixture.platform = {};
  await render(2);
  await act(async () => { pending.resolve(summary(99)); rows.resolve(rss(99)); });
  expect(current.facets).toMatchObject({ status: "unavailable", summary: { totalCount: 0 } });
  expect(current.rss).toEqual({ status: "unavailable", summary: null });
});
it("does not retain a newer snapshot across a revision rollback", async () => {
  await render(5);
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(new Promise(() => {}));
  fixture.platform.queryLibraryCore.mockReturnValueOnce(new Promise(() => {}));
  await render(1);
  expect(current.facets).toMatchObject({ status: "loading", summary: { totalCount: 0 } });
  expect(current.rss).toEqual({ status: "loading", summary: null });
});
it("ignores an obsolete rejection across an A-B-A request sequence", async () => {
  await render(1);
  const old = deferred<LibraryFacetSummary>(), fresh = deferred<LibraryFacetSummary>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(old.promise);
  await render(2);
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(fresh.promise);
  await render(1);
  await act(async () => fresh.resolve(summary(3)));
  await act(async () => old.reject(new Error("obsolete error")));
  expect(current.facets).toMatchObject({ status: "ready", summary: { totalCount: 3 } });
});
it("keeps independent family completion states instead of claiming a combined snapshot", async () => {
  await render(1);
  const facets = deferred<LibraryFacetSummary>(), rows = deferred<any>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(facets.promise);
  fixture.platform.queryLibraryCore.mockReturnValueOnce(rows.promise);
  await render(2);
  await act(async () => facets.resolve(summary(20)));
  expect(current.facets).toMatchObject({ status: "ready", summary: { totalCount: 20 } });
  expect(current.rss).toMatchObject({ status: "refreshing", summary: { totalCount: 4 } });
  await act(async () => rows.resolve(rss(8)));
  expect(current.rss).toMatchObject({ status: "ready", summary: { totalCount: 8 } });
});
it("does not let a disabled consumer evict an enabled consumer's shared query", async () => {
  function Consumers({ third = false }: { third?: boolean }) {
    useLibraryFacetSummaryState(1);
    useLibraryFacetSummaryState(1, false);
    return third ? <Harness version={1} /> : null;
  }
  await act(async () => root.render(<Consumers />));
  await act(async () => root.render(<Consumers third />));
  expect(fixture.platform.readLibraryFacetSummary).toHaveBeenCalledTimes(1);
  expect(current.facets).toMatchObject({ status: "ready", summary: { totalCount: 10 } });
});

it("consumes one runtime receipt atomically without duplicate facet or RSS queries", async () => {
  let state: any = { status: "ready", committed: { facets: summary(22354), rss: rss(99) }, activation: 1, attempts: 1, error: null };
  const listeners = new Set<() => void>();
  fixture.platform.libraryCountResource = { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  function Navigation() { current = useLibraryNavigationCounts(1); return null; }
  await act(async () => root.render(<Navigation />));
  expect(current.facets.summary.totalCount).toBe(22354); expect(current.rss.summary.totalCount).toBe(99);
  await act(async () => { state = { ...state, status: "refreshing" }; listeners.forEach(listener => listener()); });
  expect(current.facets.status).toBe("refreshing"); expect(current.facets.summary.totalCount).toBe(22354);
  await act(async () => { state = { ...state, status: "ready", committed: { facets: summary(0), rss: rss(0) } }; listeners.forEach(listener => listener()); });
  expect(current.facets.summary.totalCount).toBe(0); expect(current.rss.summary.totalCount).toBe(0);
  await act(async () => { state = { ...state, status: "unavailable", committed: null, activation: 2 }; listeners.forEach(listener => listener()); });
  expect(current.facets.summary.totalCount).toBe(0); expect(current.rss.summary).toBeNull();
  expect(fixture.platform.readLibraryFacetSummary).not.toHaveBeenCalled(); expect(fixture.platform.queryLibraryCore).not.toHaveBeenCalled();
});

it("does not resurrect pre-error facet counts while a recovery attempt is pending", async () => {
  await render(1);
  const failed = deferred<LibraryFacetSummary>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(failed.promise);
  await render(2);
  await act(async () => failed.reject(new Error("synthetic failure")));
  const recovery = deferred<LibraryFacetSummary>();
  fixture.platform.readLibraryFacetSummary.mockReturnValueOnce(recovery.promise);
  await render(3);
  expect(current.facets).toMatchObject({ status: "loading", summary: { totalCount: 0 } });
  await act(async () => recovery.resolve(summary(7)));
  expect(current.facets).toMatchObject({ status: "ready", summary: { totalCount: 7 } });
});
