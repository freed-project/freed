import { describe, expect, it, vi } from "vitest";
import type { LibraryCoreNormalizedQueryExecutor } from "@freed/shared/library-core";
import { backfillIdentityAvatars, startAvatarBackfill } from "./avatar-backfill";

describe("identity avatar backfill", () => {
  it("coalesces discovery changes during a pass and unsubscribes on shutdown", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let invalidate!: () => void;
    let done!: () => void;
    const completed = new Promise<void>(resolve => { done = resolve; });
    const unsubscribe = vi.fn();
    let reports = 0;
    const query = vi.fn(async () => { await gate; return { rows: [], nextCursor: null }; });
    const stop = startAvatarBackfill(query as unknown as LibraryCoreNormalizedQueryExecutor,
      callback => { invalidate = callback; return unsubscribe; },
      () => { if (++reports === 2) done(); });
    expect(query).toHaveBeenCalledTimes(1);
    invalidate(); invalidate();
    expect(query).toHaveBeenCalledTimes(1);
    release();
    await completed;
    expect(query).toHaveBeenCalledTimes(4);
    stop(); invalidate();
    expect(query).toHaveBeenCalledTimes(4);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("finishes every page and both identity catalogs, retaining only one page at a time", async () => {
    const visits: string[] = [];
    let inFlight = 0;
    const query = vi.fn(async (request) => {
      expect(inFlight).toBe(0);
      expect(request.limit).toBe(128);
      visits.push(`${request.queryId}:${request.cursor}`);
      return {
        rows: [{ avatarUrl: "https://images.example/one" }, { avatarUrl: "https://images.example/one" }, { avatarUrl: null }],
        nextCursor: request.queryId === "person_graph_page_v1" && request.cursor === null ? "next-person-page" : null,
      };
    });
    // The native query client owns strict row parsing. This fixture exercises
    // only traversal, backpressure and cache outcomes, not the row codec.
    const result = await backfillIdentityAvatars(query as unknown as LibraryCoreNormalizedQueryExecutor, new AbortController().signal, async () => {
      inFlight += 1;
      await Promise.resolve();
      expect(inFlight).toBe(1);
      inFlight -= 1;
      return true;
    });
    expect(visits).toEqual(["person_graph_page_v1:null", "person_graph_page_v1:next-person-page", "account_graph_page_v1:null"]);
    expect(result).toEqual({ cached: 3, unavailable: 0 });
  });

  it("continues past unavailable images without retrying, and stops on cancellation", async () => {
    const controller = new AbortController();
    const query = vi.fn(async () => ({ rows: [{ avatarUrl: "https://images.example/a" }, { avatarUrl: "https://images.example/b" }], nextCursor: null }));
    const warm = vi.fn(async () => { throw new Error("offline"); });
    expect(await backfillIdentityAvatars(query as unknown as LibraryCoreNormalizedQueryExecutor, controller.signal, warm)).toEqual({ cached: 0, unavailable: 4 });
    expect(warm).toHaveBeenCalledTimes(4);
    warm.mockImplementationOnce(async () => { controller.abort(); throw new Error("cancelled"); });
    await expect(backfillIdentityAvatars(query as unknown as LibraryCoreNormalizedQueryExecutor, controller.signal, warm)).rejects.toThrow();
    expect(warm).toHaveBeenCalledTimes(5);
  });
});
