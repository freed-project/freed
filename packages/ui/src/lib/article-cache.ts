const ARTICLE_CONTENT_CACHE_NAME = "freed-articles-v1";
const ARTICLE_IMAGE_CACHE_NAME = "freed-images";
const CACHEABLE_PROTOCOLS = new Set(["http:", "https:"]);
const IMAGE_ATTRIBUTE_NAMES = [
  "src",
  "data-src",
  "data-lazy-src",
  "data-original",
  "data-actualsrc",
];
const IMAGE_SRCSET_ATTRIBUTE_NAMES = [
  "srcset",
  "data-srcset",
  "data-lazy-srcset",
];

function resolveCacheableUrl(raw: string | null, baseUrl: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  try {
    const resolved = new URL(trimmed, baseUrl);
    return CACHEABLE_PROTOCOLS.has(resolved.protocol) ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function extractSrcsetUrls(raw: string | null, baseUrl: string): string[] {
  const srcset = raw?.trim();
  if (!srcset) return [];

  return srcset
    .split(",")
    .map((candidate) => resolveCacheableUrl(candidate.trim().split(/\s+/, 1)[0] ?? null, baseUrl))
    .filter((url): url is string => !!url);
}

export function collectCacheableArticleImageUrls(html: string, baseUrl: string): string[] {
  if (!html.trim() || typeof DOMParser === "undefined") return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const urls = new Set<string>();

  for (const image of doc.querySelectorAll("img")) {
    for (const attributeName of IMAGE_ATTRIBUTE_NAMES) {
      const resolved = resolveCacheableUrl(image.getAttribute(attributeName), baseUrl);
      if (resolved) urls.add(resolved);
    }
    for (const attributeName of IMAGE_SRCSET_ATTRIBUTE_NAMES) {
      for (const resolved of extractSrcsetUrls(image.getAttribute(attributeName), baseUrl)) {
        urls.add(resolved);
      }
    }
  }

  for (const source of doc.querySelectorAll("picture source")) {
    for (const attributeName of IMAGE_SRCSET_ATTRIBUTE_NAMES) {
      for (const resolved of extractSrcsetUrls(source.getAttribute(attributeName), baseUrl)) {
        urls.add(resolved);
      }
    }
  }

  return [...urls];
}

export async function cacheArticleHtml(articleUrl: string, globalId: string, html: string): Promise<void> {
  if (!("caches" in window)) return;

  const cache = await caches.open(ARTICLE_CONTENT_CACHE_NAME);
  const response = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await cache.put(articleUrl, response.clone());
  await cache.put(`/content/${globalId}`, response);
}

export async function warmArticleImageCache(html: string, baseUrl: string): Promise<void> {
  if (!("caches" in window)) return;

  await Promise.resolve();

  const imageUrls = collectCacheableArticleImageUrls(html, baseUrl);
  if (imageUrls.length === 0) return;

  const cache = await caches.open(ARTICLE_IMAGE_CACHE_NAME);

  await Promise.allSettled(
    imageUrls.map(async (imageUrl) => {
      const existing = await cache.match(imageUrl);
      if (existing) return;

      const response = await fetch(new Request(imageUrl, { mode: "no-cors" }));
      if (!response.ok && response.type !== "opaque") return;
      await cache.put(imageUrl, response);
    }),
  );
}

