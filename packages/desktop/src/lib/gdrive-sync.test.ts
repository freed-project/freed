import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as A from "@automerge/automerge";
import { addFeedItem, createEmptyDoc, type FreedDoc } from "@freed/shared/schema";
import type { FeedItem } from "@freed/shared";
import { gdriveDownloadLatest, gdriveStartPollLoop, gdriveUploadReplace, gdriveUploadSafe } from "@freed/sync/cloud";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
}

function responseBodyFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function makeItem(globalId: string): FeedItem {
  return {
    platform: "rss",
    contentType: "article",
    capturedAt: Date.now(),
    publishedAt: Date.now(),
    author: { id: "author-1", handle: "author", displayName: "Author" },
    content: { text: "Test content", mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    globalId,
  };
}

function makeTrustedAndDeleteHeavyDocs(): { trusted: Uint8Array; deleteHeavy: Uint8Array } {
  let trustedDoc = createEmptyDoc();
  trustedDoc = A.change(trustedDoc, (doc) => {
    for (let i = 0; i < 600; i += 1) {
      addFeedItem(doc, makeItem(`trusted-item-${i}`));
    }
  });

  let deleteHeavyDoc = A.clone(trustedDoc) as FreedDoc;
  deleteHeavyDoc = A.change(deleteHeavyDoc, (doc) => {
    for (let i = 20; i < 600; i += 1) {
      delete doc.feedItems[`trusted-item-${i}`];
    }
  });

  return {
    trusted: A.save(trustedDoc),
    deleteHeavy: A.save(deleteHeavyDoc),
  };
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
    const uploadBodies: Array<BodyInit | null | undefined> = [];
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
        uploadBodies.push(init?.body);
        return jsonResponse({});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const result = await gdriveUploadSafe("token", new Uint8Array([1, 2, 3]));

    expect(uploadHeaders).toHaveLength(1);
    expect(uploadHeaders[0]).toMatchObject({ "If-Match": '"server-etag"' });
    expect(uploadBodies[0]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(uploadBodies[0] as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(result).toMatchObject({
      fileId: "file-1",
      uploadedBytes: 3,
      remoteBytes: 0,
      mergedRemote: false,
    });
  });

  it("blocks uploads when a cloud merge would wipe out a much larger document", async () => {
    const { trusted, deleteHeavy } = makeTrustedAndDeleteHeavyDocs();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/files?")) {
        return jsonResponse({ files: [{ id: "file-1" }] });
      }
      if (url.includes("/files/file-1?fields=")) {
        return jsonResponse(
          { size: trusted.byteLength.toLocaleString("en-US", { useGrouping: false }) },
          { headers: { ETag: '"server-etag"' } },
        );
      }
      if (url.includes("/files/file-1?alt=media")) {
        return new Response(responseBodyFromBytes(trusted));
      }
      if (url.includes("/upload/drive/v3/files/file-1")) {
        throw new Error("Upload should not run after destructive merge guard blocks.");
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(gdriveUploadSafe("token", deleteHeavy)).rejects.toThrow(
      /Freed blocked a sync merge/,
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/upload/drive/v3/files/file-1"),
      expect.anything(),
    );
  });

  it("replaces Drive contents without downloading remote history for conflict recovery", async () => {
    const uploadHeaders: HeadersInit[] = [];
    const uploadBodies: Array<BodyInit | null | undefined> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/files?")) {
        return jsonResponse({ files: [{ id: "file-1" }] });
      }
      if (url.includes("/files/file-1?fields=") || url.includes("/files/file-1?alt=media")) {
        throw new Error("Authoritative replace should not download the cloud backup.");
      }
      if (url.includes("/upload/drive/v3/files/file-1")) {
        uploadHeaders.push(init?.headers ?? {});
        uploadBodies.push(init?.body);
        return jsonResponse({});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await gdriveUploadReplace("token", new Uint8Array([7, 8, 9]));

    expect(uploadHeaders).toHaveLength(1);
    expect(uploadHeaders[0]).not.toHaveProperty("If-Match");
    expect(uploadBodies[0]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(uploadBodies[0] as ArrayBuffer))).toEqual([7, 8, 9]);
    expect(result).toMatchObject({
      fileId: "file-1",
      uploadedBytes: 3,
      remoteBytes: 0,
      mergedRemote: false,
    });
  });

  it("can route Drive downloads through a platform fetcher", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const platformFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/files?")) {
        return jsonResponse({ files: [{ id: "file-1" }] });
      }
      if (url.includes("/files/file-1?fields=")) {
        return jsonResponse({ size: "0" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await expect(gdriveDownloadLatest("token", undefined, platformFetch)).resolves.toBeNull();

    expect(platformFetch).toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("preserves Google Drive error body details for sync diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/files?")) {
        return jsonResponse({
          error: {
            message: "Request had insufficient authentication scopes.",
            errors: [{ reason: "insufficientPermissions" }],
          },
        }, { status: 403, statusText: "Forbidden" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(gdriveDownloadLatest("token")).rejects.toMatchObject({
      message: "GDrive list failed: 403 Forbidden - Request had insufficient authentication scopes. (insufficientPermissions)",
      status: 403,
    });
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
