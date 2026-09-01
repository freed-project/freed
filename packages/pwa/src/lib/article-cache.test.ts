import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheArticleHtml,
  collectCacheableArticleImageUrls,
  getCachedArticleHtml,
  warmArticleImageCache,
} from "@freed/ui/lib/article-cache";

const CACHE_ORIGIN = "https://app.freed.wtf";

function normalizeCacheKey(key: RequestInfo | URL): string {
  const value =
    typeof key === "string"
      ? key
      : key instanceof URL
        ? key.href
        : key.url;
  return new URL(value, CACHE_ORIGIN).href;
}

class FakeCache {
  readonly store = new Map<string, Response>();
  activePuts = 0;
  maximumActivePuts = 0;
  putFailureKey: string | null = null;

  async delete(key: RequestInfo | URL): Promise<boolean> {
    return this.store.delete(normalizeCacheKey(key));
  }

  has(key: RequestInfo | URL): boolean {
    return this.store.has(normalizeCacheKey(key));
  }

  async keys(): Promise<Request[]> {
    return [...this.store.keys()].map((key) => new Request(key));
  }

  async match(key: RequestInfo | URL): Promise<Response | undefined> {
    return this.store.get(normalizeCacheKey(key))?.clone();
  }

  async put(key: RequestInfo | URL, response: Response): Promise<void> {
    this.activePuts += 1;
    this.maximumActivePuts = Math.max(
      this.maximumActivePuts,
      this.activePuts,
    );
    try {
      await Promise.resolve();
      const normalizedKey = normalizeCacheKey(key);
      if (normalizedKey === this.putFailureKey) {
        this.putFailureKey = null;
        throw new Error("simulated CacheStorage put failure");
      }
      this.store.delete(normalizedKey);
      this.store.set(normalizedKey, response.clone());
    } finally {
      this.activePuts -= 1;
    }
  }

  seed(key: RequestInfo | URL, response: Response): void {
    this.store.set(normalizeCacheKey(key), response);
  }
}

function installFakeCacheStorage(): {
  cache(name: string): FakeCache;
  open: ReturnType<typeof vi.fn>;
} {
  const stores = new Map<string, FakeCache>();
  const cache = (name: string) => {
    const existing = stores.get(name);
    if (existing) return existing;
    const created = new FakeCache();
    stores.set(name, created);
    return created;
  };
  const open = vi.fn(async (name: string) => cache(name));
  vi.stubGlobal("caches", { open });
  return { cache, open };
}

describe("article cache helpers", () => {
  afterEach(() => {
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

  it("stores timestamped article HTML under the source URL and content cache key", async () => {
    const now = Date.UTC(2026, 7, 31, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { cache, open } = installFakeCacheStorage();

    await cacheArticleHtml("https://example.com/article", "saved:abc123", "<article>Hello</article>");

    expect(open).toHaveBeenCalledWith("freed-articles-v1");
    const store = cache("freed-articles-v1");
    expect(store.has("https://example.com/article")).toBe(true);
    expect(store.has("/content/saved:abc123")).toBe(true);
    await expect(
      store
        .match("/content/saved:abc123")
        .then((response) => response?.headers.get("Date")),
    ).resolves.toBe(new Date(now).toUTCString());
  });

  it("enforces the unpinned CacheStorage entry ceiling", async () => {
    const { cache } = installFakeCacheStorage();
    const store = cache("freed-articles-v1");
    const legacy = new Response("legacy");
    for (let index = 0; index < 5_000; index += 1) {
      store.seed(`/legacy/${index.toLocaleString("en-US", { useGrouping: false })}`, legacy);
    }

    await cacheArticleHtml(
      "https://example.com/new-article",
      "saved:new",
      "<article>New</article>",
    );

    expect(store.store.size).toBe(5_000);
    expect(store.has("https://example.com/new-article")).toBe(true);
    expect(store.has("/content/saved:new")).toBe(true);
    expect(store.has("/legacy/0")).toBe(false);
    expect(store.has("/legacy/1")).toBe(false);
  });

  it("reconciles a partial alias write before preserving its error", async () => {
    const { cache } = installFakeCacheStorage();
    const store = cache("freed-articles-v1");
    const legacy = new Response("legacy");
    for (let index = 0; index < 5_000; index += 1) {
      store.seed(`/legacy-partial/${index.toLocaleString("en-US", { useGrouping: false })}`, legacy);
    }
    store.putFailureKey = normalizeCacheKey("/content/partial");

    await expect(
      cacheArticleHtml(
        "https://example.com/partial",
        "partial",
        "<article>Partial</article>",
      ),
    ).rejects.toThrow("simulated CacheStorage put failure");

    expect(store.store.size).toBe(5_000);
    expect(store.has("/legacy-partial/0")).toBe(false);
    expect(store.has("https://example.com/partial")).toBe(true);
    expect(store.has("/content/partial")).toBe(false);
  });

  it("retains a refreshed article ahead of older cache entries", async () => {
    const { cache } = installFakeCacheStorage();
    const store = cache("freed-articles-v1");
    const legacy = new Response("legacy");
    for (let index = 0; index < 5_000; index += 1) {
      store.seed(`/legacy-refresh/${index.toLocaleString("en-US", { useGrouping: false })}`, legacy);
    }

    await cacheArticleHtml(
      "/legacy-refresh/0",
      "refreshed",
      "<article>Refreshed</article>",
    );

    expect(store.store.size).toBe(5_000);
    expect(store.has("/legacy-refresh/0")).toBe(true);
    expect(store.has("/legacy-refresh/1")).toBe(false);
    expect(store.has("/content/refreshed")).toBe(true);
  });

  it("does not return unpinned HTML after its 30 day lifetime", async () => {
    const now = Date.UTC(2026, 7, 31, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { cache } = installFakeCacheStorage();
    cache("freed-articles-v1").seed(
      "/content/stale",
      new Response("<article>Stale</article>", {
        headers: {
          Date: new Date(now - 31 * 24 * 60 * 60 * 1_000).toUTCString(),
        },
      }),
    );

    await expect(getCachedArticleHtml("stale")).resolves.toBeNull();
    expect(cache("freed-articles-v1").has("/content/stale")).toBe(false);
  });

  it("keeps legacy unpinned aliases readable when they have no timestamp", async () => {
    const { cache } = installFakeCacheStorage();
    cache("freed-articles-v1").seed(
      "https://example.com/legacy",
      new Response("<article>Legacy</article>"),
    );

    await expect(
      getCachedArticleHtml("legacy", "https://example.com/legacy"),
    ).resolves.toBe("<article>Legacy</article>");
  });

  it("serializes concurrent article writes before retention maintenance", async () => {
    const { cache } = installFakeCacheStorage();
    const store = cache("freed-articles-v1");

    await Promise.all([
      cacheArticleHtml(
        "https://example.com/first",
        "first",
        "<article>First</article>",
      ),
      cacheArticleHtml(
        "https://example.com/second",
        "second",
        "<article>Second</article>",
      ),
    ]);

    expect(store.maximumActivePuts).toBe(1);
  });

  it("coordinates retention maintenance through one browser-wide lock", async () => {
    const request = vi.fn(
      async (_name: string, callback: () => Promise<unknown>) => callback(),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    installFakeCacheStorage();

    await cacheArticleHtml(
      "https://example.com/locked",
      "locked",
      "<article>Locked</article>",
    );

    expect(request).toHaveBeenCalledWith(
      "freed-article-cache-retention-v1",
      expect.any(Function),
    );
  });

  it("stores pinned saved HTML in the permanent article cache", async () => {
    const { cache, open } = installFakeCacheStorage();

    await cacheArticleHtml(
      "https://example.com/article",
      "saved:abc123",
      "<article>Pinned</article>",
      { pinned: true },
    );

    expect(open).toHaveBeenCalledWith("freed-articles-pinned-v1");
    const pinnedStore = cache("freed-articles-pinned-v1");
    expect(pinnedStore.has("https://example.com/article")).toBe(true);
    expect(pinnedStore.has("/content/saved:abc123")).toBe(true);
    expect(pinnedStore.has("/pinned-content/saved:abc123")).toBe(true);
    expect(cache("freed-articles-v1").store.size).toBe(0);
    await expect(getCachedArticleHtml("saved:abc123")).resolves.toBe("<article>Pinned</article>");
  });

  it("enforces the pinned CacheStorage ceiling without age eviction", async () => {
    const now = Date.UTC(2026, 7, 31, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { cache } = installFakeCacheStorage();
    const store = cache("freed-articles-pinned-v1");
    const oldPinned = new Response("pinned", {
      headers: {
        Date: new Date(now - 365 * 24 * 60 * 60 * 1_000).toUTCString(),
      },
    });
    store.seed("/pinned-content/retained", oldPinned);
    for (let index = 0; index < 9_999; index += 1) {
      store.seed(`/legacy-pinned/${index.toLocaleString("en-US", { useGrouping: false })}`, oldPinned);
    }

    await expect(getCachedArticleHtml("retained")).resolves.toBe("pinned");
    await cacheArticleHtml(
      "https://example.com/new-pinned",
      "saved:new-pinned",
      "<article>New pinned</article>",
      { pinned: true },
    );

    expect(store.store.size).toBe(10_000);
    expect(store.has("https://example.com/new-pinned")).toBe(true);
    expect(store.has("/content/saved:new-pinned")).toBe(true);
    expect(store.has("/pinned-content/saved:new-pinned")).toBe(true);
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
});
