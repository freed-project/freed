const ARTICLE_CONTENT_CACHE_NAME = "freed-articles-v1";
const PINNED_ARTICLE_CONTENT_CACHE_NAME = "freed-articles-pinned-v1";
const PINNED_CONTENT_PATH_PREFIX = "/pinned-content/";
const ARTICLE_IMAGE_CACHE_NAME = "freed-images";
const ARTICLE_CONTENT_CACHE_MAXIMUM_ENTRIES = 5_000;
const ARTICLE_CONTENT_CACHE_MAXIMUM_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const PINNED_ARTICLE_CONTENT_CACHE_MAXIMUM_ENTRIES = 10_000;
const ARTICLE_CACHE_LOCK_NAME = "freed-article-cache-retention-v1";
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

let articleCacheTask: Promise<void> = Promise.resolve();

function runArticleCacheTask<T>(operation: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator === "undefined" || !("locks" in navigator)) {
      return operation();
    }
    return await navigator.locks.request(ARTICLE_CACHE_LOCK_NAME, () =>
      operation(),
    );
  };
  const task = articleCacheTask.then(run, run);
  articleCacheTask = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function reconcileCacheEntryLimit(
  cache: Cache,
  maximumEntries: number,
): Promise<void> {
  const keys = await cache.keys();
  const overflow = keys.length - maximumEntries;
  if (overflow > 0) {
    for (let start = 0; start < overflow; start += 64) {
      await Promise.all(
        keys
          .slice(start, Math.min(start + 64, overflow))
          .map((key) => cache.delete(key)),
      );
    }
  }
}

async function putArticleCacheEntries(
  cacheName: string,
  maximumEntries: number,
  keys: readonly string[],
  response: Response,
): Promise<void> {
  const cache = await caches.open(cacheName);
  let writeFailed = false;
  let writeError: unknown;
  try {
    for (const key of keys) {
      await cache.put(key, response.clone());
    }
  } catch (error) {
    writeFailed = true;
    writeError = error;
  }
  try {
    await reconcileCacheEntryLimit(cache, maximumEntries);
  } catch (error) {
    if (!writeFailed) throw error;
  }
  if (writeFailed) throw writeError;
}

function responseIsExpired(response: Response, now: number): boolean {
  const writtenAt = Date.parse(response.headers.get("Date") ?? "");
  return (
    Number.isFinite(writtenAt) &&
    writtenAt <= now - ARTICLE_CONTENT_CACHE_MAXIMUM_AGE_MS
  );
}

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

export async function cacheArticleHtml(
  articleUrl: string,
  globalId: string,
  html: string,
  options: { pinned?: boolean } = {},
): Promise<void> {
  if (!("caches" in window)) return;

  return runArticleCacheTask(async () => {
    const cacheName = options.pinned
      ? PINNED_ARTICLE_CONTENT_CACHE_NAME
      : ARTICLE_CONTENT_CACHE_NAME;
    const response = new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        Date: new Date(Date.now()).toUTCString(),
      },
    });
    const keys = [articleUrl, `/content/${globalId}`];
    if (options.pinned) {
      keys.push(`${PINNED_CONTENT_PATH_PREFIX}${globalId}`);
    }
    await putArticleCacheEntries(
      cacheName,
      options.pinned
        ? PINNED_ARTICLE_CONTENT_CACHE_MAXIMUM_ENTRIES
        : ARTICLE_CONTENT_CACHE_MAXIMUM_ENTRIES,
      keys,
      response,
    );
  });
}

export async function getCachedArticleHtml(globalId: string, articleUrl?: string): Promise<string | null> {
  if (!("caches" in window)) return null;

  return runArticleCacheTask(async () => {
    const keys = articleUrl
      ? [`${PINNED_CONTENT_PATH_PREFIX}${globalId}`, `/content/${globalId}`, articleUrl]
      : [`${PINNED_CONTENT_PATH_PREFIX}${globalId}`, `/content/${globalId}`];
    for (const cacheName of [PINNED_ARTICLE_CONTENT_CACHE_NAME, ARTICLE_CONTENT_CACHE_NAME]) {
      const cache = await caches.open(cacheName);
      for (const key of keys) {
        const response = await cache.match(key);
        if (!response) continue;
        if (
          cacheName === ARTICLE_CONTENT_CACHE_NAME &&
          responseIsExpired(response, Date.now())
        ) {
          await cache.delete(key);
          continue;
        }
        return response.text();
      }
    }
    return null;
  });
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
