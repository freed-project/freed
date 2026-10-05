import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "../../../shared/src/types.js";
const { invoke, createService } = vi.hoisted(() => ({ invoke: vi.fn(), createService: vi.fn(() => ({ removeModel: vi.fn(), listModels: vi.fn(), invalidateModel: vi.fn().mockResolvedValue([]) })) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./local-ai-models", () => ({ createLocalAIModelService: createService }));
const item = { platform: "x", contentType: "post", content: { text: "Synthetic meetup tonight.", mediaTypes: [] } } as unknown as FeedItem;
const revision = "77a70e6cd52e602ed18184ef37d18bdd3741e3d5";
function raw(input: { labels: unknown[] }) { return { modelRevision: revision, logits: Array(input.labels.length).fill(0), truncated: false, tokenCount: 42, elapsedMs: 2 }; }
// Tier 1: no cloud fallback, incremental cache identity, selection cancellation.
describe("local GLiClass client", () => {
  beforeEach(() => { vi.resetModules(); invoke.mockReset(); createService.mockClear(); const entries = new Map(); vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key), setItem: (key: string, value: string) => entries.set(key, value) }); });
  afterEach(() => vi.unstubAllGlobals());
  it("isolates model state and pins official downloaded bytes", async () => {
    const client = await import("./gliclass-client");
    expect(createService).toHaveBeenCalledWith(undefined, [client.GLICLASS_MANIFEST], { stateFile: "gliclass-state.json" });
    expect(client.GLICLASS_MANIFEST.repo).toBe("knowledgator/gliclass-base-v3.0");
    expect(client.GLICLASS_MANIFEST.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256!))).toBe(true);
  });
  it("makes two serial local passes, then skips unchanged evidence with zero new inference", async () => {
    invoke.mockImplementation(async (command, args) => command === "request_gliclass" ? raw(args.input) : undefined);
    const client = await import("./gliclass-client"); const signal = new AbortController().signal;
    const first = await client.requestLocalGliclass(item, signal);
    const second = await client.requestLocalGliclass(item, signal);
    expect(first.cached).toBe(false); expect(second.cached).toBe(true);
    expect(second.contentSignals.inferredAt).toBe(first.contentSignals.inferredAt);
    expect(second.usage.input_tokens).toBe(0); expect(first.usage.input_tokens).toBe(84);
    expect(invoke).toHaveBeenCalledTimes(2);
    await client.requestLocalGliclass({ ...item, content: { ...item.content, text: "Changed synthetic source." } }, signal);
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(client.gliclassCounters.cacheHits).toBe(1);
  });
  it("propagates offline failures and never contacts a cloud endpoint", async () => {
    invoke.mockRejectedValue("Download the local model first."); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const client = await import("./gliclass-client");
    await expect(client.requestLocalGliclass(item, new AbortController().signal)).rejects.toThrow("Download");
    expect(fetch).not.toHaveBeenCalled(); expect(client.gliclassCounters.abstentions).toBe(1);
  });
  it("cancels on provider change and discards a late result without caching", async () => {
    let finish!: (result: unknown) => void;
    invoke.mockImplementation((command) => command === "request_gliclass" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
    const client = await import("./gliclass-client"); const provider = await import("./jev-provider");
    const pending = client.requestLocalGliclass(item, new AbortController().signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    provider.setJevClassifierProvider("jev");
    expect(invoke).toHaveBeenCalledWith("cancel_gliclass_request", expect.objectContaining({ requestId: expect.any(String) }));
    finish(raw({ labels: Array(25) })); await expect(pending).rejects.toThrow();
    expect(client.gliclassCounters.cacheHits).toBe(0);
  });
  it("invalidates readiness and cache after native integrity failure", async () => {
    invoke.mockRejectedValue("GLiClass model integrity check failed. Remove and download it again.");
    const client = await import("./gliclass-client");
    await expect(client.requestLocalGliclass(item, new AbortController().signal)).rejects.toThrow("integrity");
    expect(client.gliclassModels.invalidateModel).toHaveBeenCalledWith("gliclass-base", expect.stringContaining("integrity"));
  });

});
