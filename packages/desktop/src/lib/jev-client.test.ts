import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { JEV_MODEL, JEV_SIGNAL_KEYS } from "./jev-classification";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const item = {
  globalId: "x:real-post", platform: "x", contentType: "post",
  author: { id: "private-author", handle: "private-handle", displayName: "Private Person" },
  content: { text: "Can someone help with the community garden?", mediaTypes: [], mediaUrls: [] },
} as unknown as FeedItem;
const raw = () => ({ model: JEV_MODEL, usage: { input_tokens: 12, output_tokens: 8 },
  answers: Object.fromEntries(JEV_SIGNAL_KEYS.map(key => [key, { type: "noul", noul: 0.5 }])) });

// Tier 1: shipping IPC, cancellation and secret locality. Invalidated by Jev client/native contract changes.
describe("native Jev client", () => {
  beforeEach(() => {
    vi.resetModules(); invoke.mockReset();
    vi.stubEnv("MODE", "production"); vi.stubEnv("VITE_TEST_TAURI", "0");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("uses the OS credential commands and sends only bounded evidence through native IPC", async () => {
    invoke.mockImplementation(async (command: string) => command === "get_jev_api_key" ? "private-test-key" : command === "request_jev" ? raw() : undefined);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const client = await import("./jev-client");
    await client.jevCredentials.setApiKey("jev", "private-test-key");
    expect(invoke).toHaveBeenCalledWith("set_jev_api_key", { key: "private-test-key" });
    expect((await client.jevConnectionStatus()).configured).toBe(true);
    const result = await client.requestNativeJev("/api/jev-preview/classify", { item }, new AbortController().signal);
    expect(result.model).toBe(JEV_MODEL);
    const request = invoke.mock.calls.find(([command]) => command === "request_jev")![1];
    expect(request.payload.state.text).toBe(item.content.text);
    expect(JSON.stringify(request)).not.toContain("private-test-key");
    expect(JSON.stringify(request)).not.toContain("private-author");
    expect(fetch).not.toHaveBeenCalled();
    await client.jevCredentials.clearApiKey();
    expect(invoke).toHaveBeenCalledWith("clear_jev_api_key");
  });
  it("cancels the exact native request and discards a late result", async () => {
    let finish!: (result: unknown) => void;
    invoke.mockImplementation((command: string) => command === "request_jev" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
    const client = await import("./jev-client");
    const controller = new AbortController();
    const request = client.requestNativeJev("/api/jev-preview/classify", { item }, controller.signal);
    const rejected = expect(request).rejects.toThrow();
    const requestId = invoke.mock.calls[0][1].requestId;
    controller.abort();
    expect(invoke).toHaveBeenCalledWith("cancel_jev_request", { requestId });
    finish(raw());
    await rejected;
  });
  it("does not accept malformed native results or send a cancelled request", async () => {
    invoke.mockResolvedValue({ model: JEV_MODEL, answers: {} });
    const client = await import("./jev-client");
    await expect(client.requestNativeJev("/api/jev-preview/classify", { item }, new AbortController().signal)).rejects.toThrow();
    invoke.mockClear();
    const controller = new AbortController(); controller.abort();
    await expect(client.requestNativeJev("/api/jev-preview/classify", { item }, controller.signal)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("keeps browser credentials tab-local and replaces and removes them without native or host persistence", async () => {
    vi.stubEnv("VITE_TEST_TAURI", "1");
    const client = await import("./jev-client");
    await client.jevCredentials.setApiKey("jev", "first-test-key");
    expect(await client.jevPreviewHeaders()).toEqual({ Authorization: "Bearer first-test-key" });
    await client.jevCredentials.setApiKey("jev", "replacement-test-key");
    expect(await client.jevPreviewHeaders()).toEqual({ Authorization: "Bearer replacement-test-key" });
    await client.jevCredentials.clearApiKey();
    expect(await client.jevPreviewHeaders()).toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });
});
