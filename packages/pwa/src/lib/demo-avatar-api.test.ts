import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_CHARACTER_AVATAR_MEDIA } from "@freed/shared";
import demoAvatarSources from "./demo-avatar-sources.json";

import {
  DEMO_AVATAR_TIMEOUT_MS,
  createDemoAvatarHandler,
  type DemoAvatarRegistry,
} from "../../api/demo-avatar";

function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

function createResponse() {
  const headers = new Map<string, string>();
  const state: { status: number; body?: Uint8Array; ended: boolean } = {
    status: 200,
    ended: false,
  };
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      state.status = code;
      return response;
    },
    send(body: Uint8Array) {
      state.body = body;
    },
    end() {
      state.ended = true;
    },
  };
  return { response, headers, state };
}

function fixtureRegistry(bytes: Uint8Array): DemoAvatarRegistry {
  return [{ sha1: sha1(bytes), imageUrl: "https://fixtures.example/avatar.jpg" }];
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("demo avatar relay", () => {
  it("registers every reviewed portrait that cannot use Commons CORS delivery", () => {
    const registry: Record<string, string> = demoAvatarSources;
    const missing: { character: string; sha1: string; imageUrl: string }[] = [];
    for (const [character, asset] of SAMPLE_CHARACTER_AVATAR_MEDIA) {
      const host = new URL(asset.baseUrl).hostname;
      if (host === "thumb.wikimedia.org" || host === "upload.wikimedia.org") continue;
      if (registry[asset.sha1] !== asset.baseUrl) {
        missing.push({ character, sha1: asset.sha1, imageUrl: asset.baseUrl });
      }
    }
    expect(missing, "Every reviewed remote portrait needs an exact relay registration").toEqual([]);
  });

  it("rejects missing, malformed, and unknown SHA values before any fetch", async () => {
    const fetchMock = vi.fn();
    const handler = createDemoAvatarHandler({ fetchImpl: fetchMock });

    for (const sha of [undefined, "not-a-sha", "0".repeat(40)]) {
      const { response, state, headers } = createResponse();
      await handler({ method: "GET", query: { sha } }, response);
      expect(state.status).toBe(sha === "0".repeat(40) ? 404 : 400);
      expect(headers.get("cache-control")).toBe("no-store");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows only GET and HEAD", async () => {
    const fetchMock = vi.fn();
    const { response, state, headers } = createResponse();

    await createDemoAvatarHandler({ fetchImpl: fetchMock })({ method: "POST" }, response);

    expect(state.status).toBe(405);
    expect(headers.get("allow")).toBe("GET, HEAD");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects extra query keys before fetching a known image", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
    const registry = fixtureRegistry(bytes);
    const fetchMock = vi.fn();
    const { response, state } = createResponse();
    await createDemoAvatarHandler({ fetchImpl: fetchMock, registry })(
      { method: "GET", query: { sha: registry[0]!.sha1, url: "https://attacker.example/a.jpg" } },
      response,
    );
    expect(state.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches only the registry URL with bounded anonymous requests", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
    const registry = fixtureRegistry(bytes);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
    );
    const { response, state } = createResponse();

    await createDemoAvatarHandler({ fetchImpl: fetchMock, registry })(
      { method: "GET", query: { sha: registry[0]!.sha1 } },
      response,
    );

    expect(state.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://fixtures.example/avatar.jpg",
      expect.objectContaining({
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "image/jpeg, image/png, image/webp" },
      }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(DEMO_AVATAR_TIMEOUT_MS).toBe(5_000);
  });

  it("admits hash-matched WebP containers but rejects truncated or non-WebP RIFF bodies", async () => {
    for (const [signature, expectedStatus] of [
      ["RIFF1234WEBPpayload", 200],
      ["RIFF1234WAVEpayload", 502],
      ["RIFF1234WEB", 502],
      ["xxxx1234WEBPpayload", 502],
    ] as const) {
      const bytes = new TextEncoder().encode(signature);
      const registry = fixtureRegistry(bytes);
      const { response, state, headers } = createResponse();
      await createDemoAvatarHandler({
        registry,
        fetchImpl: vi.fn().mockResolvedValue(new Response(bytes, {
          headers: { "content-type": "image/webp" },
        })),
      })({ method: "GET", query: { sha: registry[0]!.sha1 } }, response);
      expect(state.status).toBe(expectedStatus);
      if (expectedStatus === 200) expect(headers.get("content-type")).toBe("image/webp");
    }
  });

  it("turns redirect refusal and upstream timeout or error into no-store 502s", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 3, 4, 0xff, 0xd9]);
    const registry = fixtureRegistry(bytes);
    for (const failure of [
      new TypeError("redirect rejected"),
      new DOMException("timeout", "TimeoutError"),
      new Error("upstream socket closed"),
    ]) {
      const fetchMock = vi.fn().mockRejectedValue(failure);
      const { response, state, headers } = createResponse();
      await createDemoAvatarHandler({ fetchImpl: fetchMock, registry })(
        { method: "GET", query: { sha: registry[0]!.sha1 } },
        response,
      );
      expect(state.status).toBe(502);
      expect(headers.get("cache-control")).toBe("no-store");
      expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
    }
  });

  it("rejects declared and streamed bodies above four MiB", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 5, 6, 0xff, 0xd9]);
    const registry = fixtureRegistry(bytes);
    const overLimit = 4 * 1024 * 1024 + 1;
    const responses = [
      new Response(bytes, {
        headers: { "content-type": "image/jpeg", "content-length": String(overLimit) },
      }),
      new Response(streamFromChunks([Uint8Array.of(0xff, 0xd8), new Uint8Array(overLimit)]), {
        headers: { "content-type": "image/jpeg" },
      }),
    ];
    for (const upstreamResponse of responses) {
      const { response, state, headers } = createResponse();
      await createDemoAvatarHandler({
        registry,
        fetchImpl: vi.fn().mockResolvedValue(upstreamResponse),
      })({ method: "GET", query: { sha: registry[0]!.sha1 } }, response);
      expect(state.status).toBe(502);
      expect(headers.get("cache-control")).toBe("no-store");
    }
  });

  it("cancels bodies rejected before streaming", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 5, 6, 0xff, 0xd9]);
    const registry = fixtureRegistry(bytes);
    const cancelled: boolean[] = [];
    const rejectedResponses = [
      new Response(
        new ReadableStream({ cancel: () => void cancelled.push(true) }),
        { status: 503, headers: { "content-type": "image/jpeg" } },
      ),
      new Response(
        new ReadableStream({ cancel: () => void cancelled.push(true) }),
        { headers: { "content-type": "image/svg+xml" } },
      ),
      new Response(
        new ReadableStream({ cancel: () => void cancelled.push(true) }),
        {
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(4 * 1024 * 1024 + 1),
          },
        },
      ),
    ];
    for (const upstreamResponse of rejectedResponses) {
      const { response, state } = createResponse();
      await createDemoAvatarHandler({
        registry,
        fetchImpl: vi.fn().mockResolvedValue(upstreamResponse),
      })({ method: "GET", query: { sha: registry[0]!.sha1 } }, response);
      expect(state.status).toBe(502);
    }
    expect(cancelled).toHaveLength(3);
  });

  it("rejects forbidden formats, MIME/signature mismatches, truncated PNG magic and mismatched SHA", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 7, 8, 0xff, 0xd9]);
    const registry = fixtureRegistry(bytes);
    const responses = [
      new Response(bytes, { headers: { "content-type": "image/png" } }),
      new Response(bytes, { headers: { "content-type": "image/svg+xml" } }),
      new Response(bytes, { headers: { "content-type": "image/webp" } }),
      new Response(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), {
        headers: { "content-type": "image/png" },
      }),
      new Response(bytes, { headers: { "content-type": "image/jpeg-malicious" } }),
      new Response(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), {
        headers: { "content-type": "image/jpeg" },
      }),
      new Response(Uint8Array.of(0xff, 0xd8, 9, 10, 0xff, 0xd9), {
        headers: { "content-type": "image/jpeg" },
      }),
    ];
    for (const upstreamResponse of responses) {
      const { response, state } = createResponse();
      await createDemoAvatarHandler({
        registry,
        fetchImpl: vi.fn().mockResolvedValue(upstreamResponse),
      })({ method: "GET", query: { sha: registry[0]!.sha1 } }, response);
      expect(state.status).toBe(502);
    }
  });

  it.each([
    ["image/jpeg", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/png", [0xff, 0xd8, 0xff, 11]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ] as const)("rejects hash-matched bytes whose signature does not match %s", async (contentType, signature) => {
    const bytes = Uint8Array.from(signature);
    const registry = fixtureRegistry(bytes);
    const { response, state, headers } = createResponse();
    await createDemoAvatarHandler({
      registry,
      fetchImpl: vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": contentType } })),
    })({ method: "GET", query: { sha: registry[0]!.sha1 } }, response);
    expect(state.status).toBe(502);
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["image/jpeg", [0xff, 0xd8, 11, 12, 13, 0xff, 0xd9]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 11, 12]],
  ] as const)("serves a hash-verified %s fixture with matching MIME and no body for HEAD", async (contentType, signature) => {
    const bytes = Uint8Array.from(signature);
    const registry = fixtureRegistry(bytes);
    const responseFor = () =>
      new Response(bytes, { headers: { "content-type": `${contentType}; charset=binary` } });
    const get = createResponse();
    await createDemoAvatarHandler({
      registry,
      fetchImpl: vi.fn().mockImplementation(responseFor),
    })({ method: "GET", query: { sha: registry[0]!.sha1 } }, get.response);
    expect(get.state.status).toBe(200);
    expect(Buffer.isBuffer(get.state.body)).toBe(true);
    expect([...get.state.body!]).toEqual([...bytes]);
    expect(get.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400, immutable",
    );
    expect(get.headers.get("content-type")).toBe(contentType);
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");

    const head = createResponse();
    await createDemoAvatarHandler({
      registry,
      fetchImpl: vi.fn().mockImplementation(responseFor),
    })({ method: "HEAD", query: { sha: registry[0]!.sha1 } }, head.response);
    expect(head.state.status).toBe(200);
    expect(head.state.body).toBeUndefined();
    expect(head.state.ended).toBe(true);
  });
});
