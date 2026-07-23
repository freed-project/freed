import {
  canonicalEssayProviderUrl,
  type EssayProvider,
  type FeedItem,
} from "@freed/shared";
import { contentCache } from "./content-cache.js";
import { renderFeedItemReaderHtml } from "./reader-item-html.js";

const CACHE_CONCURRENCY = 4;

export interface RssEssayCacheResult {
  attempted: number;
  cached: number;
  skipped: number;
  failed: number;
}

function itemUrl(item: FeedItem): string | undefined {
  return canonicalEssayProviderUrl(
    item.content.linkPreview?.url ?? item.sourceUrl,
  );
}

function isRssEssay(
  item: FeedItem,
): item is FeedItem & { platform: EssayProvider } {
  return (
    (item.platform === "substack" || item.platform === "medium") &&
    item.contentType === "article" &&
    Boolean(item.rssSource) &&
    Boolean(item.content.text?.trim())
  );
}

function addId(map: Map<string, Set<string>>, key: string, globalId: string): void {
  const ids = map.get(key) ?? new Set<string>();
  ids.add(globalId);
  map.set(key, ids);
}

function existingEssayIdsByUrl(
  existingItems: readonly FeedItem[],
): {
  rss: Map<string, Set<string>>;
  provider: Map<string, Set<string>>;
} {
  const rss = new Map<string, Set<string>>();
  const provider = new Map<string, Set<string>>();

  for (const item of existingItems) {
    const url = itemUrl(item);
    if (!url) continue;
    if (item.platform === "rss") {
      addId(rss, url, item.globalId);
      continue;
    }
    if (
      item.contentType === "article" &&
      (item.platform === "substack" || item.platform === "medium")
    ) {
      addId(provider, `${item.platform}:${url}`, item.globalId);
    }
  }

  return { rss, provider };
}

/**
 * Preserve complete essay text supplied by user-added provider RSS feeds before
 * the Automerge worker compacts synced item text. Existing legacy RSS IDs get
 * the same local body so identity migration cannot orphan the cached article.
 */
export async function cacheRssEssayBodies(
  items: readonly FeedItem[],
  existingItems: readonly FeedItem[],
): Promise<RssEssayCacheResult> {
  const existingIds = existingEssayIdsByUrl(existingItems);
  const writes = new Map<string, string>();

  for (const item of items) {
    if (!isRssEssay(item)) continue;
    const html = renderFeedItemReaderHtml(item);
    const ids = new Set<string>([item.globalId]);
    const url = itemUrl(item);
    if (url) {
      for (const id of existingIds.rss.get(url) ?? []) ids.add(id);
      for (const id of existingIds.provider.get(`${item.platform}:${url}`) ?? []) {
        ids.add(id);
      }
    }
    for (const id of ids) writes.set(id, html);
  }

  const result: RssEssayCacheResult = {
    attempted: writes.size,
    cached: 0,
    skipped: 0,
    failed: 0,
  };
  const entries = [...writes.entries()];

  for (let index = 0; index < entries.length; index += CACHE_CONCURRENCY) {
    const batch = entries.slice(index, index + CACHE_CONCURRENCY);
    await Promise.all(
      batch.map(async ([globalId, html]) => {
        try {
          const existing = await contentCache.get(globalId);
          if (existing && existing.length >= html.length) {
            result.skipped += 1;
            return;
          }
          await contentCache.set(globalId, html);
          result.cached += 1;
        } catch {
          result.failed += 1;
        }
      }),
    );
  }

  return result;
}
