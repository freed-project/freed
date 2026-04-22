import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheArticleHtml,
  collectCacheableArticleImageUrls,
  warmArticleImageCache,
} from "@freed/ui/lib/article-cache";

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
