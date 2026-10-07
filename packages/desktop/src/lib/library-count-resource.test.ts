import { describe, expect, it, vi } from "vitest";
import type { LibraryCoreNormalizedQueryExecutor } from "@freed/shared/library-core";
import { createDesktopLibraryCountResource, LibraryCountSourceRaceError, LibraryCountSupersededError } from "./library-count-resource";
const A = { libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) };
const source = (revision = 1) => ({ generationId: "d".repeat(64), projectionRevision: revision, transitionSequence: revision });
const summary = (totalCount = 22354) => ({ archivedCount: 0, archivableCount: 0, contactAccountCount: 0,
  contactLinkedPersonCount: 0, enabledRssFeedCount: 0, friendPersonCount: 6, latestContactImportedAt: null,
  latestRssFeedFetchedAt: null, platformCounts: [{ platform: "x", totalCount, unreadCount: 0,
    archivableCount: 0, latestCapturedAt: null, latestPublishedAt: null }], rssFeedCount: 0,
  sampleAccountCount: 0, sampleFeedCount: 0, sampleItemCount: 0, samplePersonCount: 0, savedArchivedCount: 0,
  savedCount: 50, savedPlatformCount: 1, socialAccountCount: 0, tags: ["synthetic"], totalCount, unreadCount: 0 });
function queryFor(revision = 1, count = 22354) {
  return vi.fn(async (request: { queryId: string }) => ({ queryId: request.queryId, schemaVersion: 1,
    source: source(revision), ...(request.queryId === "library_facet_summary_v1"
      ? { summary: summary(count) } : request.queryId === "preferences_snapshot_v1" ? { rows: [] }
      : { totalCount: 99, unreadCount: 0 }) })) as unknown as LibraryCoreNormalizedQueryExecutor;
}
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const setup = () => { const resource = createDesktopLibraryCountResource(); resource.setSelection(A); return resource; };
describe("runtime navigation count publication", () => {
  it("publishes an unenrolled viewer identity and retires it upon enrollment", async () => {
    const resource = createDesktopLibraryCountResource();
    const viewer = { ...A, actorId: null };
    resource.setSelection(viewer);
    await resource.refresh(queryFor(), async () => viewer);
    expect(resource.getSnapshot().committed?.selection).toEqual(viewer);
    const gate = deferred<void>(), query = queryFor(2);
    const pending = resource.refresh(async request => { await gate.promise; return query(request); }, async () => viewer);
    const failure = expect(pending).rejects.toBeInstanceOf(LibraryCountSupersededError);
    resource.setSelection(A);
    expect(resource.getSnapshot().committed).toBeNull();
    gate.resolve(); await failure;
    await resource.refresh(queryFor(), async () => A);
    expect(resource.getSnapshot().committed?.selection).toEqual(A);
  });
  it("publishes one immutable receipt from three bounded reads", async () => {
    const resource = setup(), query = queryFor(), seen: string[] = [];
    resource.subscribe(() => seen.push(resource.getSnapshot().status));
    expect((await resource.refresh(query, async () => A)).totalItemCount).toBe(22354);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(3); expect(seen).toEqual(["loading", "ready"]);
    const c = resource.getSnapshot().committed!;
    for (const v of [c, c.selection, c.source, c.facets, c.facets.tags, c.facets.platformCounts, c.facets.platformCounts[0], c.rss]) expect(Object.isFrozen(v)).toBe(true);
  });
  it("retains committed values through refresh/error and applies genuine zero", async () => {
    const resource = setup(); await resource.refresh(queryFor(), async () => A);
    const gate = deferred<unknown>(), query = vi.fn(() => gate.promise) as unknown as LibraryCoreNormalizedQueryExecutor;
    const pending = resource.refresh(query, async () => A);
    expect(resource.getSnapshot().status).toBe("refreshing"); expect(resource.getSnapshot().committed?.facets.totalCount).toBe(22354);
    const failure = expect(pending).rejects.toThrow("synthetic failure"); gate.reject(new Error("synthetic failure")); await failure;
    expect(resource.getSnapshot()).toMatchObject({ status: "error", attempts: 1, error: "query" });
    expect(resource.getSnapshot().committed?.facets.totalCount).toBe(22354);
    await resource.refresh(queryFor(2, 0), async () => A); expect(resource.getSnapshot().committed?.facets.totalCount).toBe(0);
  });
  it.each(["generationId", "projectionRevision", "transitionSequence"] as const)("requires matching %s and exhausts after three attempts", async field => {
    const resource = setup(); await resource.refresh(queryFor(), async () => A); const base = queryFor(2);
    const query = vi.fn(async (request: Parameters<LibraryCoreNormalizedQueryExecutor>[0]) => {
      const result = await (base as unknown as (request: unknown) => Promise<{source: ReturnType<typeof source>}>)(request);
      return request.queryId === "rss_item_summary_v1" ? { ...result, source: { ...result.source,
        [field]: field === "generationId" ? "e".repeat(64) : 3 } } : result;
    }) as unknown as LibraryCoreNormalizedQueryExecutor;
    await expect(resource.refresh(query, async () => A)).rejects.toBeInstanceOf(LibraryCountSourceRaceError);
    expect(vi.mocked(query)).toHaveBeenCalledTimes(9);
    expect(resource.getSnapshot()).toMatchObject({ status: "error", attempts: 3, error: "source-race" });
    expect(resource.getSnapshot().committed?.facets.totalCount).toBe(field === "generationId" ? undefined : 22354);
  });
  it("drains rejected siblings before returning error", async () => {
    const resource = setup(), gate = deferred<unknown>();
    const query = vi.fn((request: {queryId: string}) => request.queryId === "library_facet_summary_v1"
      ? Promise.reject(new Error("bad facet")) : gate.promise) as unknown as LibraryCoreNormalizedQueryExecutor;
    let finished = false; const pending = resource.refresh(query, async () => A); void pending.catch(() => { finished = true; });
    await tick(); expect(finished).toBe(false); expect(vi.mocked(query)).toHaveBeenCalledTimes(3);
    const failure = expect(pending).rejects.toThrow("bad facet"); gate.reject(new Error("drained")); await failure;
  });
  it("coalesces overlapping demand into a later pass while publishing the first receipt", async () => {
    const resource = setup(), gate = deferred<void>(), base = queryFor(1);
    const firstQuery = vi.fn(async (request: Parameters<LibraryCoreNormalizedQueryExecutor>[0]) => { await gate.promise; return base(request as never); }) as unknown as LibraryCoreNormalizedQueryExecutor;
    const first = resource.refresh(firstQuery, async () => A), next = queryFor(2);
    const second = resource.refresh(next, async () => A), third = resource.refresh(next, async () => A);
    expect(second).toBe(third); expect(vi.mocked(next)).not.toHaveBeenCalled();
    const committed: number[] = []; resource.subscribe(() => { const rev = resource.getSnapshot().committed?.source.projectionRevision; if (rev !== undefined) committed.push(rev); });
    gate.resolve(); await first; await second;
    expect(vi.mocked(next)).toHaveBeenCalledTimes(3); expect(committed).toContain(1); expect(committed.at(-1)).toBe(2);
  });
  it.each(["libraryId", "authorityEpochId", "actorId"] as const)("clears resident counts on %s change at equal revision", async field => {
    const resource = setup(); await resource.refresh(queryFor(), async () => A);
    const B = { ...A, [field]: "f".repeat(64) }; resource.setSelection(B); expect(resource.getSnapshot().committed).toBeNull();
    await resource.refresh(queryFor(), async () => B); expect(resource.getSnapshot().committed?.selection).toEqual(B);
  });
  it("fences A-B-A and ignores retired success", async () => {
    const resource = setup(), gate = deferred<void>(), base = queryFor(9);
    const oldQuery = vi.fn(async (request: Parameters<LibraryCoreNormalizedQueryExecutor>[0]) => { await gate.promise; return base(request as never); }) as unknown as LibraryCoreNormalizedQueryExecutor;
    const old = resource.refresh(oldQuery, async () => A), failure = expect(old).rejects.toBeInstanceOf(LibraryCountSupersededError);
    resource.setSelection({ ...A, actorId: "f".repeat(64) }); resource.setSelection(A);
    await resource.refresh(queryFor(1), async () => A); gate.resolve(); await failure;
    expect(resource.getSnapshot()).toMatchObject({ status: "ready", committed: { source: { projectionRevision: 1 } } });
  });
  it("blocks selection during nested transitions and never restores retired identity", async () => {
    const resource = setup(); await resource.refresh(queryFor(), async () => A);
    const outer = resource.beginTransition(), inner = resource.beginTransition(); resource.setSelection(A); inner(); resource.setSelection(A);
    await expect(resource.refresh(queryFor(), async () => A)).rejects.toBeInstanceOf(LibraryCountSupersededError);
    outer(); outer(); expect(resource.getSnapshot().committed).toBeNull(); resource.setSelection(A);
    await resource.refresh(queryFor(), async () => A); expect(resource.getSnapshot().status).toBe("ready");
  });
});

it("ignores a retired error after lower-revision reactivation", async () => {
  const resource = setup(); await resource.refresh(queryFor(9), async () => A);
  const gate = deferred<unknown>();
  const query = vi.fn(() => gate.promise) as unknown as LibraryCoreNormalizedQueryExecutor;
  const old = resource.refresh(query, async () => A), failure = expect(old).rejects.toBeInstanceOf(LibraryCountSupersededError);
  resource.beginTransition()(); resource.setSelection(A);
  await resource.refresh(queryFor(1), async () => A); gate.reject(new Error("obsolete")); await failure;
  expect(resource.getSnapshot()).toMatchObject({ status: "ready", committed: { source: { projectionRevision: 1 } } });
});
