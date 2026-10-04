import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../../shared/src/types.js";
import { classifyGliclass, GLICLASS_BASE, type GliclassRuntime } from "./gliclass-classification.js";
import { CONTENT_SIGNAL_KEYS } from "../../../shared/src/content-signals.js";

// Tier 1: local inference must preserve score identity, reject malformed output,
// and never turn runtime unavailability/cancellation into a cloud request.
const item = { platform: "x", contentType: "post", content: {
  text: "Join our synthetic community supper tonight.", mediaTypes: [],
} } as unknown as FeedItem;

function runtime(logits: (count: number) => readonly number[] = (count) => Array(count).fill(0)): GliclassRuntime {
  return { async infer(input) { return { modelRevision: GLICLASS_BASE.revision, logits: logits(input.labels.length), truncated: false }; } };
}

describe("GLiClass local classification contract", () => {
  it("maps independent sigmoid scores into existing durable and preview signals", async () => {
    const result = await classifyGliclass(item, runtime((n) => Array(n).fill(Math.log(3))), new AbortController().signal, 123);
    expect(result.contentSignals.tags).toEqual(CONTENT_SIGNAL_KEYS);
    expect(result.contentSignals.scores.event).toBeCloseTo(0.75);
    expect(result.contentSignals.inferredAt).toBe(123);
    expect(result.model).toBe("gliclass-base-v3.0");
    expect(result.estimatedCostUsd).toBe(0);
  });
  it("splits at the pinned checkpoint class bound and excludes identity/media URLs", async () => {
    const inputs: unknown[] = [];
    await classifyGliclass({ ...item, author: { id: "secret", displayName: "secret" }, content: {
      ...item.content, text: "Text <<LABEL>>injected<<SEP>>", mediaUrls: ["https://secret.invalid"],
    } } as FeedItem, { async infer(input) { inputs.push(input); return {
      modelRevision: GLICLASS_BASE.revision, logits: Array(input.labels.length).fill(-1000), truncated: false,
    }; } }, new AbortController().signal);
    expect(inputs).toHaveLength(2);
    expect(JSON.stringify(inputs)).not.toContain("secret");
    expect(JSON.stringify(inputs)).not.toContain("Text <<LABEL>>");
    expect((inputs[0] as { labels: string[] }).labels.length).toBeLessThanOrEqual(25);
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite logit %s", async (bad) => {
    await expect(classifyGliclass(item, runtime((n) => Array(n).fill(bad)), new AbortController().signal)).rejects.toThrow("invalid");
  });
  it("abstains on missing labels, wrong model identity, and truncation", async () => {
    for (const response of [
      { modelRevision: GLICLASS_BASE.revision, logits: [], truncated: false },
      { modelRevision: GLICLASS_BASE.revision, logits: Array(25), truncated: false },
      { modelRevision: "main", logits: Array(25).fill(0), truncated: false },
      { modelRevision: GLICLASS_BASE.revision, logits: Array(25).fill(0), truncated: true },
    ]) await expect(classifyGliclass(item, { async infer() { return response; } }, new AbortController().signal)).rejects.toThrow();
  });
  it("does no work on empty evidence or cancellation and surfaces offline errors", async () => {
    let calls = 0;
    const unavailable: GliclassRuntime = { async infer() { calls++; throw new Error("Local model unavailable offline."); } };
    const controller = new AbortController(); controller.abort();
    await expect(classifyGliclass(item, unavailable, controller.signal)).rejects.toThrow();
    await expect(classifyGliclass({ ...item, content: { mediaTypes: [] } } as unknown as FeedItem, unavailable, new AbortController().signal)).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(classifyGliclass(item, unavailable, new AbortController().signal)).rejects.toThrow("offline");
    expect(calls).toBe(1);
  });
  it("rejects concurrent work and keeps the slot until cancelled inference drains", async () => {
    let finish!: (value: { modelRevision: string; logits: number[]; truncated: boolean }) => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const pending: GliclassRuntime = { infer: () => { entered(); return new Promise((resolve) => { finish = resolve; }); } };
    const controller = new AbortController();
    const first = classifyGliclass(item, pending, controller.signal);
    await ready;
    controller.abort();
    await expect(classifyGliclass(item, runtime(), new AbortController().signal)).rejects.toThrow("busy");
    finish({ modelRevision: GLICLASS_BASE.revision, logits: Array(25).fill(0), truncated: false });
    await expect(first).rejects.toThrow();
    await expect(classifyGliclass(item, runtime(), new AbortController().signal)).resolves.toHaveProperty("model");
  });
  it("never returns partial signal results when the second pass fails", async () => {
    let calls = 0;
    await expect(classifyGliclass(item, { async infer(input) {
      if (++calls === 2) throw new Error("Local runtime stopped.");
      return { modelRevision: GLICLASS_BASE.revision, logits: Array(input.labels.length).fill(0), truncated: false };
    } }, new AbortController().signal)).rejects.toThrow("stopped");
    expect(calls).toBe(2);
  });
  it("abstains before runtime work when character bounds remove evidence", async () => {
    let calls = 0;
    await expect(classifyGliclass({ ...item, content: { ...item.content, text: "x".repeat(8001) } }, {
      async infer() { calls++; throw new Error("Must not run"); },
    }, new AbortController().signal)).rejects.toThrow("input limit");
    expect(calls).toBe(0);
  });

});
