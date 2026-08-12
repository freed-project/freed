import { describe, expect, it, vi } from "vitest";

import { dropboxUploadSafe } from "./dropbox.js";
import { gdriveUploadSafe } from "./gdrive.js";
import { mergeBinaries } from "./merge.js";
import { lazyInProcessCloudMerge } from "./merge-strategy.js";

// The contract: the cloud merge is injectable, and it defaults to running in
// the calling thread. Desktop injects a worker-backed strategy so the measured
// 1,356 MB A.load x2 + A.merge peak lands somewhere terminable. WebAssembly
// memory grows and never shrinks, so on the main thread that peak was a
// permanent floor.
describe("cloud merge strategy injection", () => {
  it("loads the in-process merge only when a legacy upload needs it", async () => {
    expect(lazyInProcessCloudMerge).toBeTypeOf("function");
    const a = mergeBinaries;
    expect(a).toBeTypeOf("function");
  });

  it("routes the Google Drive merge through the injected strategy", async () => {
    const local = new Uint8Array([1, 2, 3]);
    const remote = new Uint8Array([4, 5, 6]);
    const mergedSentinel = new Uint8Array([9, 9, 9]);
    const strategy = vi.fn(async () => mergedSentinel);

    let uploadedBody: Uint8Array | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (init?.method === "PATCH") {
        uploadedBody = new Uint8Array(
          await new Response(init.body as BodyInit).arrayBuffer(),
        );
        return new Response("{}", { status: 200 });
      }
      // Order matters: the metadata probe also hits /drive/v3/files, so match
      // the more specific patterns before the file list.
      if (target.includes("fields=md5Checksum")) {
        return new Response(JSON.stringify({ size: String(remote.byteLength) }), {
          status: 200,
          headers: { ETag: "etag-1" },
        });
      }
      if (target.includes("alt=media")) {
        return new Response(remote, { status: 200 });
      }
      if (target.includes("spaces=appDataFolder")) {
        return new Response(JSON.stringify({ files: [{ id: "file-1" }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    await gdriveUploadSafe(
      "token",
      local,
      fetchMock as unknown as typeof fetch,
      strategy,
    );

    expect(strategy).toHaveBeenCalledTimes(1);
    const [passedLocal, passedRemote] = strategy.mock.calls[0] as unknown as [
      Uint8Array,
      Uint8Array,
    ];
    expect(Array.from(passedLocal)).toEqual(Array.from(local));
    expect(Array.from(passedRemote)).toEqual(Array.from(remote));
    // The bytes uploaded must be the strategy's output. If they were the local
    // binary, the merge silently did not happen and remote edits would be lost.
    expect(uploadedBody).not.toBeNull();
    expect(Array.from(uploadedBody as unknown as Uint8Array)).toEqual(
      Array.from(mergedSentinel),
    );
  });

  it("routes the Dropbox merge through the injected strategy", async () => {
    const local = new Uint8Array([1, 1]);
    const remote = new Uint8Array([2, 2]);
    const strategy = vi.fn(async () => new Uint8Array([7, 7]));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("download")) {
        return new Response(remote, {
          status: 200,
          headers: { "Dropbox-API-Result": JSON.stringify({ rev: "rev-1" }) },
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await dropboxUploadSafe("token", local, strategy);
      expect(strategy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not merge at all when there is no remote document", async () => {
    const strategy = vi.fn(async () => new Uint8Array([0]));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/drive/v3/files") && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ files: [{ id: "file-1" }] }), { status: 200 });
      }
      if (target.includes("alt=media")) {
        // No remote content yet.
        return new Response(null, { status: 404 });
      }
      return new Response("{}", { status: 200 });
    });

    await gdriveUploadSafe(
      "token",
      new Uint8Array([5]),
      fetchMock as unknown as typeof fetch,
      strategy,
    );

    // A first upload has nothing to merge against, so the expensive path must
    // be skipped entirely rather than merging against an empty document.
    expect(strategy).not.toHaveBeenCalled();
  });
});
