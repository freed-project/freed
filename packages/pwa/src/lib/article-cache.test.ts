import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheArticleHtml,
  clearArticleCacheStorage,
  collectCacheableArticleImageUrls,
  getCachedArticleHtml,
  warmArticleImageCache,
} from "@freed/ui/lib/article-cache";
import {
  resetFactoryResetStateForTests,
  runFactoryResetOperations,
} from "@freed/ui/lib/factory-reset";

function runEmptyReset(): Promise<void> {
  return runFactoryResetOperations({
    quiesceLocalWriters: [],
    clearDeviceStores: () => [],
    clearLocalSettings: [],
    clearLocalData: [],
    clearProviderDataAndConnections: async () => undefined,
    clearDocument: async () => undefined,
  });
}

describe("article cache helpers", () => {
  afterEach(() => {
    resetFactoryResetStateForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("collects cacheable article image URLs from img and picture markup", () => {
    const html = `
      <article>
        <img src="/hero.jpg" data-src="https://cdn.example.com/lazy.jpg" />
        <img srcset="/small.jpg 1x, /large.jpg 2x" />
        <picture>
          <source srcset="https://img.example.com/one.webp 1x, https://img.example.com/two.webp 2x" />
          <img src="data:image/png;base64,abc" />
        </picture>
      </article>
    `;

    expect(collectCacheableArticleImageUrls(html, "https://example.com/posts/1")).toEqual([
      "https://example.com/hero.jpg",
      "https://cdn.example.com/lazy.jpg",
      "https://example.com/small.jpg",
      "https://example.com/large.jpg",
      "https://img.example.com/one.webp",
      "https://img.example.com/two.webp",
    ]);
  });

  it("stores article HTML under both the source URL and content cache key", async () => {
    const put = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({ put }));

    vi.stubGlobal("caches", { open });

    await cacheArticleHtml("https://example.com/article", "saved:abc123", "<article>Hello</article>");

    expect(open).toHaveBeenCalledWith("freed-articles-v1");
    expect(put).toHaveBeenNthCalledWith(
      1,
      "https://example.com/article",
      expect.any(Response),
    );
    expect(put).toHaveBeenNthCalledWith(
      2,
      "/content/saved:abc123",
      expect.any(Response),
    );
  });

  it("stores pinned saved HTML in the permanent article cache", async () => {
    const pinnedStore = new Map<string, Response>();
    const normalStore = new Map<string, Response>();
    const open = vi.fn(async (name: string) => {
      const store = name === "freed-articles-pinned-v1" ? pinnedStore : normalStore;
      return {
        put: vi.fn(async (key: string, response: Response) => {
          store.set(key, response);
        }),
        match: vi.fn(async (key: string) => store.get(key)),
      };
    });

    vi.stubGlobal("caches", { open });

    await cacheArticleHtml(
      "https://example.com/article",
      "saved:abc123",
      "<article>Pinned</article>",
      { pinned: true },
    );

    expect(open).toHaveBeenCalledWith("freed-articles-pinned-v1");
    expect(pinnedStore.has("https://example.com/article")).toBe(true);
    expect(pinnedStore.has("/content/saved:abc123")).toBe(true);
    expect(pinnedStore.has("/pinned-content/saved:abc123")).toBe(true);
    expect(normalStore.size).toBe(0);
    await expect(getCachedArticleHtml("saved:abc123")).resolves.toBe("<article>Pinned</article>");
  });

  it("warms only uncached article images", async () => {
    const put = vi.fn(async () => undefined);
    const match = vi.fn(async (url: string) => (
      url === "https://example.com/already-cached.jpg"
        ? new Response("cached")
        : undefined
    ));
    const open = vi.fn(async () => ({ match, put }));
    const fetchMock = vi.fn(async () => new Response("image-bytes"));

    vi.stubGlobal("caches", { open });
    vi.stubGlobal("fetch", fetchMock);

    await warmArticleImageCache(
      `
        <article>
          <img src="/already-cached.jpg" />
          <img src="/needs-cache.jpg" />
        </article>
      `,
      "https://example.com/post",
    );

    expect(open).toHaveBeenCalledWith("freed-images");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(match).toHaveBeenCalledWith("https://example.com/already-cached.jpg");
    expect(match).toHaveBeenCalledWith("https://example.com/needs-cache.jpg");
    expect(put).toHaveBeenCalledWith(
      "https://example.com/needs-cache.jpg",
      expect.any(Response),
    );
  });

  it("clears every mutable cache while preserving the Workbox app shell", async () => {
    const deleteCache = vi
      .fn<(cacheName: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    const keys = vi.fn(async () => [
      "workbox-precache-v2-https://app.freed.wtf/",
      "freed-articles-v1",
      "freed-sync-v1",
      "freed-network",
      "freed-wasm",
      "future-user-data-cache",
    ]);
    vi.stubGlobal("caches", { delete: deleteCache, keys });

    await clearArticleCacheStorage();

    expect(new Set(deleteCache.mock.calls.map(([cacheName]) => cacheName))).toEqual(new Set([
      "freed-articles-v1",
      "freed-articles-pinned-v1",
      "freed-images",
      "freed-sync-v1",
      "freed-network",
      "freed-wasm",
      "future-user-data-cache",
    ]));
    expect(deleteCache).not.toHaveBeenCalledWith(
      "workbox-precache-v2-https://app.freed.wtf/",
    );
  });

  it("does not commit delayed article HTML after factory reset starts", async () => {
    const put = vi.fn(async () => undefined);
    let finishOpen!: (cache: { put: typeof put }) => void;
    const open = vi.fn(() => new Promise<{ put: typeof put }>((resolve) => {
      finishOpen = resolve;
    }));
    vi.stubGlobal("caches", { open });

    const write = cacheArticleHtml(
      "https://example.com/delayed",
      "saved:delayed",
      "<article>Delayed</article>",
    );
    const reset = runEmptyReset();
    finishOpen({ put });

    await write;
    await reset;
    expect(put).not.toHaveBeenCalled();
  });

  it("drains a delayed cache lookup without reopening caches after reset starts", async () => {
    const match = vi.fn(async () => undefined);
    let finishOpen!: (cache: { match: typeof match }) => void;
    const open = vi.fn(() => new Promise<{ match: typeof match }>((resolve) => {
      finishOpen = resolve;
    }));
    vi.stubGlobal("caches", { open });

    const lookup = getCachedArticleHtml("saved:delayed-read");
    const reset = runEmptyReset();
    finishOpen({ match });

    await expect(lookup).resolves.toBeNull();
    await reset;
    expect(open).toHaveBeenCalledOnce();
    expect(match).not.toHaveBeenCalled();
  });

  it("does not commit delayed article images after factory reset starts", async () => {
    let finishFetch!: (response: Response) => void;
    const put = vi.fn(async () => undefined);
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finishFetch = resolve;
    }));
    vi.stubGlobal("caches", {
      open: vi.fn(async () => ({
        match: vi.fn(async () => undefined),
        put,
      })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const warming = warmArticleImageCache(
      '<img src="https://example.com/delayed.jpg" />',
      "https://example.com/article",
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const reset = runEmptyReset();
    finishFetch(new Response("image"));

    await warming;
    await reset;
    expect(put).not.toHaveBeenCalled();
  });
});
