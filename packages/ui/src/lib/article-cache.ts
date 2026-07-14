import {
  captureFactoryResetWriteEpoch,
  isFactoryResetWriteAllowed,
  trackFactoryResetSensitiveOperation,
} from "./factory-reset.js";

const ARTICLE_CONTENT_CACHE_NAME = "freed-articles-v1";
const PINNED_ARTICLE_CONTENT_CACHE_NAME = "freed-articles-pinned-v1";
const PINNED_CONTENT_PATH_PREFIX = "/pinned-content/";
const ARTICLE_IMAGE_CACHE_NAME = "freed-images";
const KNOWN_USER_DATA_CACHE_NAMES = [
  ARTICLE_CONTENT_CACHE_NAME,
  PINNED_ARTICLE_CONTENT_CACHE_NAME,
  ARTICLE_IMAGE_CACHE_NAME,
  "freed-sync-v1",
  "freed-network",
  "freed-wasm",
];
const IMMUTABLE_APP_SHELL_CACHE_PREFIX = "workbox-precache";
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

export function cacheArticleHtml(
  articleUrl: string,
  globalId: string,
  html: string,
  options: { pinned?: boolean } = {},
): Promise<void> {
  if (!("caches" in window)) return Promise.resolve();
  const writeEpoch = captureFactoryResetWriteEpoch();
  if (!isFactoryResetWriteAllowed(writeEpoch)) return Promise.resolve();

  return trackFactoryResetSensitiveOperation((async () => {
    const cache = await caches.open(
      options.pinned ? PINNED_ARTICLE_CONTENT_CACHE_NAME : ARTICLE_CONTENT_CACHE_NAME,
    );
    if (!isFactoryResetWriteAllowed(writeEpoch)) return;
    const response = new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

    await cache.put(articleUrl, response.clone());
    if (!isFactoryResetWriteAllowed(writeEpoch)) return;
    await cache.put(`/content/${globalId}`, response.clone());
    if (options.pinned && isFactoryResetWriteAllowed(writeEpoch)) {
      await cache.put(`${PINNED_CONTENT_PATH_PREFIX}${globalId}`, response);
    }
  })());
}

export function getCachedArticleHtml(
  globalId: string,
  articleUrl?: string,
): Promise<string | null> {
  if (!("caches" in window)) return Promise.resolve(null);
  const writeEpoch = captureFactoryResetWriteEpoch();
  if (!isFactoryResetWriteAllowed(writeEpoch)) return Promise.resolve(null);

  return trackFactoryResetSensitiveOperation((async () => {
    const keys = articleUrl
      ? [`${PINNED_CONTENT_PATH_PREFIX}${globalId}`, `/content/${globalId}`, articleUrl]
      : [`${PINNED_CONTENT_PATH_PREFIX}${globalId}`, `/content/${globalId}`];
    for (const cacheName of [PINNED_ARTICLE_CONTENT_CACHE_NAME, ARTICLE_CONTENT_CACHE_NAME]) {
      if (!isFactoryResetWriteAllowed(writeEpoch)) return null;
      const cache = await caches.open(cacheName);
      if (!isFactoryResetWriteAllowed(writeEpoch)) return null;
      for (const key of keys) {
        const response = await cache.match(key);
        if (response) return response.text();
      }
    }

    return null;
  })());
}

export async function clearArticleCacheStorage(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;

  const existingNames = typeof caches.keys === "function" ? await caches.keys() : [];
  const namesToDelete = new Set([
    ...KNOWN_USER_DATA_CACHE_NAMES,
    ...existingNames.filter((cacheName) => !cacheName.startsWith(IMMUTABLE_APP_SHELL_CACHE_PREFIX)),
  ]);
  await Promise.all([...namesToDelete].map((cacheName) => caches.delete(cacheName)));
}

export function warmArticleImageCache(html: string, baseUrl: string): Promise<void> {
  if (!("caches" in window)) return Promise.resolve();
  const writeEpoch = captureFactoryResetWriteEpoch();
  if (!isFactoryResetWriteAllowed(writeEpoch)) return Promise.resolve();

  return trackFactoryResetSensitiveOperation((async () => {
    await Promise.resolve();
    if (!isFactoryResetWriteAllowed(writeEpoch)) return;

    const imageUrls = collectCacheableArticleImageUrls(html, baseUrl);
    if (imageUrls.length === 0) return;

    const cache = await caches.open(ARTICLE_IMAGE_CACHE_NAME);
    if (!isFactoryResetWriteAllowed(writeEpoch)) return;

    await Promise.allSettled(
      imageUrls.map(async (imageUrl) => {
        if (!isFactoryResetWriteAllowed(writeEpoch)) return;
        const existing = await cache.match(imageUrl);
        if (existing || !isFactoryResetWriteAllowed(writeEpoch)) return;

        const response = await fetch(new Request(imageUrl, { mode: "no-cors" }));
        if (
          (!response.ok && response.type !== "opaque") ||
          !isFactoryResetWriteAllowed(writeEpoch)
        ) return;
        await cache.put(imageUrl, response);
      }),
    );
  })());
}
