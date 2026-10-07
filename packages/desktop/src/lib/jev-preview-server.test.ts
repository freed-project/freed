import { createServer, request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJevPreviewMiddleware } from "../../dev/jev-preview-server.mjs";
import * as contract from "./jev-classification";
import { CONTENT_SIGNAL_KEYS, type FeedItem } from "@freed/shared";

const item: FeedItem = {
  globalId: "sample-jev-post",
  platform: "facebook",
  contentType: "post",
  capturedAt: 1,
  publishedAt: 1,
  author: { id: "sample-author", handle: "sample", displayName: "Sample Author" },
  sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "jev-test", generatedAt: 0, generatorVersion: 1 },
  content: { text: "Join our neighborhood gathering tomorrow at noon.", mediaTypes: [], mediaUrls: [] },
  userState: { hidden: false, saved: false, archived: false, tags: [] },
  topics: [],
};
const responseBody = () => ({
  model: contract.JEV_MODEL,
  answers: Object.fromEntries(contract.JEV_SIGNAL_KEYS.map(key => [key, { type: "noul", noul: key === "event" ? 0.9 : 0.1 }])),
  usage: { input_tokens: 2_000, output_tokens: 100 },
});
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function start(options: Partial<Parameters<typeof createJevPreviewMiddleware>[0]> = {}) {
  const upstream = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(responseBody())));
  const handler = createJevPreviewMiddleware({
    loadContract: async () => contract,
    getApiKey: async () => "private-test-key",
    fetchImpl: upstream,
    ...options,
  });
  const server = createServer((req, res) => void handler(req, res, () => {
    res.writeHead(404); res.end();
  }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  const url = `http://127.0.0.1:${address.port}`;
  const postTo = (path: "classify" | "match", body: unknown, extraHeaders: Record<string, string> = {}, signal?: AbortSignal) => fetch(`${url}/api/jev-preview/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-freed-jev-preview": "1", ...extraHeaders },
    body: JSON.stringify(body), signal,
  });
  const post = (body: unknown = { item }, extraHeaders: Record<string, string> = {}, signal?: AbortSignal) => postTo("classify", body, extraHeaders, signal);
  const match = (body: unknown = { item, capabilities: ["Plumbing"] }, extraHeaders: Record<string, string> = {}) => postTo("match", body, extraHeaders);
  return { url, post, match, upstream };
}

describe("Jev preview server boundary", () => {
  it("blocks default paid preview transport before credential reads", async () => {
    const credential = vi.fn();
    const { post, match } = await start({ fetchImpl: globalThis.fetch, getApiKey: credential });
    expect((await post()).status).toBe(403);
    expect((await match()).status).toBe(403);
    expect(credential).not.toHaveBeenCalled();
  });
  it("keeps the credential server-side and rejects cross-origin or non-sample requests before upstream contact", async () => {
    const { url, post, match, upstream } = await start();
    const status = await (await fetch(`${url}/api/jev-preview/status`)).json();
    expect(status).toMatchObject({ configured: true, maxConcurrency: 4, model: contract.JEV_MODEL });
    expect(JSON.stringify(status)).not.toContain("private-test-key");
    expect((await post({ item }, { origin: "https://attacker.example" })).status).toBe(403);
    expect((await post({ item }, { "x-freed-jev-preview": "" })).status).toBe(403);
    expect((await post({ item: { ...item, sampleDataFingerprint: undefined } })).status).toBe(422);
    expect((await match({ item, capabilities: ["Plumbing"] }, { origin: "https://attacker.example" })).status).toBe(403);
    expect((await match({ item: { ...item, sampleDataFingerprint: undefined }, capabilities: ["Plumbing"] })).status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
    const good = await post();
    expect(good.status).toBe(200);
    expect(upstream.mock.calls[0]?.[0]).toBe("https://api.typesafe.ai/v1/systemone");
    expect(upstream.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer private-test-key" });
    expect(await good.text()).not.toContain("private-test-key");
  });

  it("isolates cached responses when the client replaces its credential", async () => {
    const { post, upstream } = await start({ getApiKey: undefined });
    const firstHeaders = { Authorization: "Bearer first-test-key" };
    const secondHeaders = { Authorization: "Bearer second-test-key" };
    expect(await (await post({ item }, firstHeaders)).json()).toMatchObject({ cached: false });
    expect(await (await post({ item }, secondHeaders)).json()).toMatchObject({ cached: false });
    expect(await (await post({ item }, secondHeaders)).json()).toMatchObject({ cached: true });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls[1]?.[1]?.headers).toMatchObject(secondHeaders);
  });

  it("caches validated results, accounts only fresh calls, and honors explicit reclassification", async () => {
    const { post, upstream } = await start();
    const first = await (await post()).json();
    const cached = await (await post()).json();
    const fresh = await (await post({ item, reclassify: true })).json();
    expect(first).toMatchObject({ cached: false, contentSignals: { method: "ai", tags: ["event"] } });
    expect(first.questionPackVersion).toBe("freed-signals-v2");
    expect(Object.keys(first.contentSignals.scores)).toEqual(CONTENT_SIGNAL_KEYS);
    expect(Object.keys(first.experimentalSignals.scores)).toEqual(contract.JEV_EXPERIMENTAL_SIGNAL_KEYS);
    expect(first.estimatedCostUsd).toBeCloseTo(0.000084);
    expect(cached).toMatchObject({ cached: true, estimatedCostUsd: 0 });
    expect(fresh.cached).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed responses without caching them or disclosing upstream error bodies", async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...responseBody(), answers: {} })))
      .mockResolvedValueOnce(new Response("private-test-key raw payload", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody())));
    const { post } = await start({ fetchImpl: upstream });
    expect(await (await post()).json()).toMatchObject({ code: "invalid_response" });
    const rejected = await post();
    expect(rejected.status).toBe(401);
    expect(await rejected.text()).not.toContain("private-test-key");
    expect((await post()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("retries overload once, honors retry-after, and bounds lifetime upstream attempts", async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => new Response("busy", { status: 429, headers: { "retry-after": "2" } }));
    const wait = vi.fn().mockResolvedValue(undefined);
    const { post } = await start({ fetchImpl: upstream, wait, maxAttempts: 2 });
    expect((await post()).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(2_000, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await (await post()).json()).toMatchObject({ code: "preview_budget" });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("settles a transport deadline and releases its admission slot", async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const { post } = await start({ fetchImpl: upstream, deadlineMs: 500 });
    const result = await post();
    expect(result.status).toBe(504);
    expect(await result.json()).toMatchObject({ code: "deadline" });
    upstream.mockResolvedValue(new Response(JSON.stringify(responseBody())));
    expect((await post()).status).toBe(200);
  });

  it("does not overflow a long retry-after into an immediate retry", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", {
      status: 429, headers: { "retry-after": "9999999999" },
    }));
    const wait = vi.fn().mockResolvedValue(undefined);
    const { post } = await start({ fetchImpl: upstream, wait });
    expect(await (await post()).json()).toMatchObject({ code: "jev_429" });
    expect(upstream).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("expires incomplete request bodies, flushes their errors, and releases every admission slot", async () => {
    const { url, post, upstream } = await start({ deadlineMs: 500 });
    const pending = Array.from({ length: 4 }, () => new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const request = httpRequest(`${url}/api/jev-preview/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-freed-jev-preview": "1" },
      }, response => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { body += chunk; });
        response.on("end", () => {
          request.destroy();
          resolve({ status: response.statusCode, body });
        });
        response.on("error", reject);
      });
      request.on("error", reject);
      // Deliberately leave the body open. The server's injected short deadline
      // must settle it without another byte, an EOF, or a client disconnect.
      request.write("{");
    }));
    const expired = await Promise.all(pending);
    for (const result of expired) {
      expect(result.status).toBe(504);
      expect(JSON.parse(result.body)).toMatchObject({ code: "deadline" });
    }
    expect(upstream).not.toHaveBeenCalled();
    expect((await post()).status).toBe(200);
  });

  it("rejects an oversized body and closes its connection without contacting Jev", async () => {
    const { post, upstream } = await start();
    const rejected = await post({ item, padding: "x".repeat(65_536) });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ code: "invalid_item" });
    expect(rejected.headers.get("connection")).toBe("close");
    expect(upstream).not.toHaveBeenCalled();
    expect((await post()).status).toBe(200);
  });

  it("reports an absent key without contacting Jev", async () => {
    const { url, post, match, upstream } = await start({ getApiKey: async () => "" });
    expect(await (await fetch(`${url}/api/jev-preview/status`)).json()).toMatchObject({ configured: false });
    expect(await (await post()).json()).toMatchObject({ code: "key_missing" });
    expect(await (await match()).json()).toMatchObject({ code: "key_missing" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("binds contextual cache entries to capabilities and shares the upstream attempt budget", async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: contract.JEV_MODEL,
        answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, { type: "noul", noul: key === "help_capability_0" ? 0.8 : 0.1 }])),
        usage: { input_tokens: 1_000, output_tokens: 100 },
      }));
    });
    const { match, post } = await start({ fetchImpl: upstream, maxAttempts: 3 });
    const first = await (await match()).json();
    expect(first).toMatchObject({ questionPackVersion: "freed-context-v1", cached: false,
      explicitHelpRequest: 0.1, collaborationInvitation: 0.1,
      helpCapabilityScores: [0.8], collaborationCapabilityScores: [0.1] });
    expect(first).not.toHaveProperty("contentSignals");
    expect(first.estimatedCostUsd).toBeCloseTo(0.000042);
    expect(await (await match()).json()).toMatchObject({ cached: true, estimatedCostUsd: 0 });
    expect(await (await match({ item, capabilities: ["Design"] })).json()).toMatchObject({ cached: false });
    expect((await post()).status).toBe(200);
    expect(await (await match({ item, capabilities: ["Translation"] })).json()).toMatchObject({ code: "preview_budget" });
    expect(upstream).toHaveBeenCalledTimes(3);
    const sent = JSON.parse(String(upstream.mock.calls[0]?.[1]?.body));
    expect(sent.state).toEqual({ content: contract.buildJevRequest(item).state, capabilities: ["Plumbing"] });
    expect(sent.state.content).not.toHaveProperty("author");
  });

  it("rejects malformed profiles and contextual answers before exposing or caching matches", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(responseBody())));
    const { match } = await start({ fetchImpl: upstream });
    for (const capabilities of [undefined, [], [""], ["x".repeat(121)], Array(9).fill("Design")]) {
      expect((await match({ item, capabilities })).status).toBe(422);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(await (await match()).json()).toMatchObject({ code: "invalid_response" });
    upstream.mockResolvedValue(new Response(JSON.stringify({
      model: contract.JEV_MODEL,
      answers: Object.fromEntries(Object.keys(contract.buildJevMatchRequest(item, ["Plumbing"]).questions)
        .map(key => [key, { type: "noul", noul: 0.2 }])),
      usage: { input_tokens: 1_000, output_tokens: 100 },
    })));
    expect(await (await match()).json()).toMatchObject({ cached: false, helpCapabilityScores: [0.2] });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("shares the four-request admission limit between classification and contextual matching", async () => {
    const releases: Array<(response: Response) => void> = [];
    const upstream = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    const { post, match } = await start({ fetchImpl: upstream });
    const pending = Array.from({ length: 4 }, () => post());
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(4));
    expect(await (await match()).json()).toMatchObject({ code: "preview_busy" });
    releases.forEach(resolve => resolve(new Response(JSON.stringify(responseBody()))));
    expect((await Promise.all(pending)).map(response => response.status)).toEqual([200, 200, 200, 200]);
  });
});
