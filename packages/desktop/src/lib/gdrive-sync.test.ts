import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gdriveStartPollLoop, gdriveUploadSafe } from "@freed/sync/cloud";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
}

describe("Google Drive cloud sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls the appDataFolder changes space used for the Freed document", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/changes/startPageToken")) {
        return jsonResponse({ startPageToken: "cursor-1" });
      }
      if (url.includes("/files?")) {
        return jsonResponse({ files: [{ id: "file-1" }] });
      }
      if (url.includes("/changes?")) {
        return jsonResponse({ newStartPageToken: "cursor-2", changes: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const poll = gdriveStartPollLoop("token", vi.fn(), controller.signal);
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(5_000);

    const changeUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/changes?"));

    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    await poll;

    expect(changeUrl).toContain("spaces=appDataFolder");
  });

  it("uses the Drive metadata ETag for conditional uploads when Google provides one", async () => {
    const uploadHeaders: HeadersInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/files?")) {
        return jsonResponse({ files: [{ id: "file-1" }] });
      }
      if (url.includes("/files/file-1?fields=")) {
        return jsonResponse({ size: "0" }, { headers: { ETag: '"server-etag"' } });
      }
      if (url.includes("/upload/drive/v3/files/file-1")) {
        uploadHeaders.push(init?.headers ?? {});
        return jsonResponse({});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await gdriveUploadSafe("token", new Uint8Array([1, 2, 3]));

    expect(uploadHeaders).toHaveLength(1);
    expect(uploadHeaders[0]).toMatchObject({ "If-Match": '"server-etag"' });
  });

  it("omits If-Match instead of sending an invalid md5 checksum as an ETag", async () => {
    const uploadHeaders: HeadersInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/files?")) {
        return jsonResponse({ files: [{ id: "file-1" }] });
      }
      if (url.includes("/files/file-1?fields=")) {
        return jsonResponse({ size: "0", md5Checksum: "not-an-etag" });
      }
      if (url.includes("/upload/drive/v3/files/file-1")) {
        uploadHeaders.push(init?.headers ?? {});
        return jsonResponse({});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await gdriveUploadSafe("token", new Uint8Array([1, 2, 3]));

    expect(uploadHeaders).toHaveLength(1);
    expect(uploadHeaders[0]).not.toHaveProperty("If-Match");
  });
});
