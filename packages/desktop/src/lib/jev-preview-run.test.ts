import { describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { applyJevPreviewComparison, jevPreviewSourceKey, runJevPreview, runJevPreviewBatch, type JevPreviewResponse } from "./jev-preview-run";

// Tier 1: bounded paid requests, cancellation, and failed-write accounting.
// Invalidated by runner, request eligibility, or response/analysis contract changes.
function item(index: number): FeedItem {
  return {
    globalId: `instagram:sample-${index}`,
    platform: "instagram",
    contentType: "story",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "sample", handle: "sample", displayName: "Sample" },
    content: { text: "Join our community supper tomorrow.", mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "jev-test", generatedAt: 1, generatorVersion: 1 },
  };
}

function response(): JevPreviewResponse {
  return {
    contentSignals: { version: 3, method: "ai", inferredAt: 1, scores: { event: 0.9 }, tags: ["event"] },
    experimentalSignals: { version: 1, method: "ai", inferredAt: 1,
      scores: { help_offered: 0, collaboration: 0, work_in_progress: 0, appreciation: 0, humor: 0, correction: 0 }, tags: [] },
    model: "jev-1.13.0",
    usage: { input_tokens: 100, output_tokens: 20 },
    estimatedCostUsd: 0.0000042,
    cached: false,
    elapsedMs: 1,
  };
}

describe("Jev preview request runner", () => {
  it("uses the shared queue for contextual response shapes without a ContentSignals write", async () => {
    const received = { helpCapabilityScores: [0.9], collaborationCapabilityScores: [0.1] };
    const apply = vi.fn(async () => {});
    const validate = vi.fn((source: FeedItem) => { if (source.globalId === item(1).globalId) throw new Error("No declared capability"); });
    const results = await runJevPreviewBatch([item(0), item(1)], {
      signal: new AbortController().signal, validate, apply,
      classify: async () => received, onUpdate: () => {},
    });
    expect(results.map(result => result.status)).toEqual(["success", "skipped"]);
    expect(results[0]?.response).toBe(received);
    expect(apply).toHaveBeenCalledExactlyOnceWith(item(0), received);
  });
  it.each(["rules", "jev"] as const)("finishes the %s comparison past media-only items and preserves their prior signals", async (mode) => {
    const first = item(0);
    const mediaOnly = item(1);
    mediaOnly.content.text = "";
    mediaOnly.content.mediaTypes = ["image"];
    mediaOnly.contentSignals = { version: 3, method: "manual", inferredAt: 1, scores: { media: 1 }, tags: ["media"] };
    const priorSignals = structuredClone(mediaOnly.contentSignals);
    const last = item(2);
    const apply = vi.fn(async (source: FeedItem, signals: JevPreviewResponse["contentSignals"]) => {
      source.contentSignals = signals;
    });

    await applyJevPreviewComparison([first, mediaOnly, last], mode, {
      [first.globalId]: { sourceKey: jevPreviewSourceKey(first)!, contentSignals: response().contentSignals },
    }, { signal: new AbortController().signal, apply });

    expect(apply).toHaveBeenCalledTimes(2);
    expect(mediaOnly.contentSignals).toEqual(priorSignals);
    expect(first.contentSignals?.method).toBe(mode === "jev" ? "ai" : "rules");
    expect(last.contentSignals?.method).toBe("rules");
  });

  it("cannot restore a decision after the same ID loads edited evidence, provenance, or author", async () => {
    const original = item(0);
    const received = response();
    const decisions = { [original.globalId]: {
      sourceKey: jevPreviewSourceKey(original)!,
      contentSignals: received.contentSignals,
      experimentalSignals: received.experimentalSignals,
    } };
    // This is the Reload sample regression: the apply callback receives the
    // new item, so only the cache's original source fence can reject old scores.
    const replacements = [
      (changed: FeedItem) => { changed.content.text = "The supper was cancelled."; },
      (changed: FeedItem) => { changed.sampleDataFingerprint!.batchId = "replacement-batch"; },
      (changed: FeedItem) => { changed.sampleDataFingerprint!.generatedAt += 1; },
      (changed: FeedItem) => { changed.sampleDataFingerprint!.generatorVersion += 1; },
      (changed: FeedItem) => { changed.author.id = "different-author"; },
      (changed: FeedItem) => { changed.content.mediaTypes = ["image"]; },
    ];
    for (const replace of replacements) {
      const reloaded = structuredClone(original);
      replace(reloaded);
      const apply = vi.fn(async () => {});
      await applyJevPreviewComparison([reloaded], "jev", decisions, {
        signal: new AbortController().signal, apply,
      });
      expect(apply).toHaveBeenCalledExactlyOnceWith(reloaded, expect.objectContaining({ method: "rules" }));
      expect(jevPreviewSourceKey(reloaded)).not.toBe(decisions[original.globalId].sourceKey);
    }
  });

  it("retains decisions across unrelated item edits and treats unavailable evidence as ineligible", async () => {
    const original = item(0);
    const changed = structuredClone(original);
    changed.userState.saved = true;
    changed.contentSignals = response().contentSignals;
    changed.topics = ["community"];
    const decisions = { [original.globalId]: {
      sourceKey: jevPreviewSourceKey(original)!, contentSignals: response().contentSignals,
    } };
    const apply = vi.fn(async () => {});
    await applyJevPreviewComparison([changed], "jev", decisions, {
      signal: new AbortController().signal, apply,
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith(changed, decisions[original.globalId].contentSignals);
    changed.content.text = "";
    expect(jevPreviewSourceKey(changed)).toBeNull();
  });

  it("limits pending requests to four and cancellation prevents queued requests or writes", async () => {
    const controller = new AbortController();
    const releases: Array<(value: JevPreviewResponse) => void> = [];
    const classify = vi.fn(() => new Promise<JevPreviewResponse>((resolve) => releases.push(resolve)));
    const apply = vi.fn(async () => {});
    const run = runJevPreview(Array.from({ length: 10 }, (_, index) => item(index)), {
      signal: controller.signal, classify, apply, onUpdate: () => {},
    });
    expect(classify).toHaveBeenCalledTimes(4);
    controller.abort();
    releases.forEach((release) => release(response()));
    const results = await run;
    expect(classify).toHaveBeenCalledTimes(4);
    expect(apply).not.toHaveBeenCalled();
    expect(results.every((result) => result.status === "cancelled")).toBe(true);
    expect(results.filter((result) => result.response)).toHaveLength(4);
  });

  it("skips media with no text but accepts link descriptions and continues after failures", async () => {
    const media = item(0);
    media.content.text = "";
    media.content.mediaTypes = ["image"];
    const link = item(1);
    link.content.text = "";
    link.content.linkPreview = { url: "https://example.invalid", description: "A guide to growing tomatoes." };
    const classify = vi.fn(async (source: FeedItem, _signal: AbortSignal, _reclassify: boolean) => {
      if (source.globalId === item(2).globalId) throw new Error("Service unavailable");
      return response();
    });
    const apply = vi.fn(async () => {});
    const results = await runJevPreview([media, link, item(2), item(3)], {
      signal: new AbortController().signal, reclassify: true, classify, apply, onUpdate: () => {},
    });
    expect(results.map((result) => result.status)).toEqual(["skipped", "success", "failed", "success"]);
    expect(results[0].error).toContain("media has not been analyzed");
    expect(classify).toHaveBeenCalledTimes(3);
    expect(classify.mock.calls.every((call) => call[2] === true)).toBe(true);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("retains usage when a stale library write fails without reporting success", async () => {
    const received = response();
    const apply = vi.fn(async () => { throw new Error("Source evidence changed"); });
    const results = await runJevPreview([item(0)], {
      signal: new AbortController().signal, classify: async () => received, apply, onUpdate: () => {},
    });
    expect(results[0]).toMatchObject({ status: "failed", response: received, error: "Source evidence changed" });
  });

  it.each([
    [401, "jev_401"], [503, "key_missing"], [429, "preview_budget"],
    [500, "preview_unavailable"], [429, "jev_429"], [503, "jev_529"],
  ])("stops on %s %s, aborts siblings, and leaves the owner's signal untouched", async (status, code) => {
    const owner = new AbortController();
    const addListener = vi.spyOn(owner.signal, "addEventListener");
    const removeListener = vi.spyOn(owner.signal, "removeEventListener");
    const activeSignals: AbortSignal[] = [];
    let finishFirst: (response: Response) => void = () => {};
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init!.signal as AbortSignal;
      activeSignals.push(signal);
      return new Promise<Response>((resolve, reject) => {
        if (activeSignals.length === 1) finishFirst = resolve;
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const apply = vi.fn(async () => {});
    vi.stubGlobal("fetch", fetchMock);
    try {
      const run = runJevPreview(Array.from({ length: 10 }, (_, index) => item(index)), {
        signal: owner.signal, apply, onUpdate: () => {},
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
      finishFirst(new Response(JSON.stringify({ code, error: "The classification endpoint rejected this run." }), {
        status: status as number, headers: { "Content-Type": "application/json" },
      }));
      const results = await run;
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(apply).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({ status: "failed", error: "The classification endpoint rejected this run. The run stopped and remaining requests were cancelled." });
      expect(results.slice(1).every((result) => result.status === "cancelled")).toBe(true);
      expect(activeSignals.every((signal) => signal.aborted)).toBe(true);
      expect(owner.signal.aborted).toBe(false);
      expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0][1]);
    } finally {
      vi.unstubAllGlobals();
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });
});
