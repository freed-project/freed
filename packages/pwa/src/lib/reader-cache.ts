import type { FeedItem } from "@freed/shared";
import type { ReaderHydrationResult } from "@freed/ui/context";
import { cacheArticleHtml, warmArticleImageCache } from "@freed/ui/lib/article-cache";
import {
  getReaderOfflineCacheMode,
  shouldPinOpenedReaderItem,
  type ReaderOfflineCacheMode,
} from "@freed/ui/lib/reader-cache-settings";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFallbackHtml(item: FeedItem): string {
  const title = item.content.linkPreview?.title ?? item.content.text?.slice(0, 100) ?? item.author.displayName;
  const media = item.content.mediaUrls
    .map((url, index) => {
      const safeUrl = escapeHtml(url);
      return item.content.mediaTypes[index] === "video"
        ? `<figure><video src="${safeUrl}" controls playsinline></video></figure>`
        : `<figure><img src="${safeUrl}" alt="" /></figure>`;
    })
    .join("");
  const paragraphs = (item.preservedContent?.text ?? item.content.text ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

  return `<article><h1>${escapeHtml(title)}</h1>${media}${paragraphs}</article>`;
}

function cacheKeyForItem(item: FeedItem): string {
  return item.content.linkPreview?.url ?? item.sourceUrl ?? `/reader-item/${encodeURIComponent(item.globalId)}`;
}

async function cacheFallback(item: FeedItem, pinned: boolean): Promise<string> {
  const html = renderFallbackHtml(item);
  await cacheArticleHtml(cacheKeyForItem(item), item.globalId, html, { pinned });
  return html;
}

export async function hydrateReaderItemInPwa(
  item: FeedItem,
  options: { cacheMode: ReaderOfflineCacheMode; pin: boolean },
): Promise<ReaderHydrationResult> {
  const url = item.content.linkPreview?.url;
  const pinned = options.pin || item.userState.saved || shouldPinOpenedReaderItem(options.cacheMode);

  if (!url) {
    const html = pinned ? await cacheFallback(item, true) : undefined;
    return {
      html,
      mediaUrls: item.content.mediaUrls,
      mediaTypes: item.content.mediaTypes,
      status: item.content.mediaUrls.length > 0 || html ? "partial" : "unsupported",
    };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const fallbackHtml = pinned ? await cacheFallback(item, true) : undefined;
      return {
        html: fallbackHtml,
        status: fallbackHtml ? "partial" : "unsupported",
        message: `The source returned ${response.status.toLocaleString()}.`,
      };
    }

    const html = await response.text();
    await cacheArticleHtml(url, item.globalId, html, { pinned });
    void warmArticleImageCache(html, url);
    return { html, status: pinned ? "hydrated" : "partial" };
  } catch {
    const fallbackHtml = pinned ? await cacheFallback(item, true) : undefined;
    return {
      html: fallbackHtml,
      status: fallbackHtml ? "partial" : "unsupported",
      message: fallbackHtml ? "Showing the locally preserved reader copy." : undefined,
    };
  }
}

export async function pinReaderItemInPwa(item: FeedItem): Promise<void> {
  await hydrateReaderItemInPwa(item, {
    cacheMode: getReaderOfflineCacheMode(),
    pin: true,
  });
}
