import {
  buildSavedFeedItem,
  extractContentBrowser,
  extractMetadataBrowser,
} from "@freed/capture-save";
import { toast } from "@freed/ui/components/Toast";
import { docAddFeedItem, docAddStubItem } from "./automerge";

const FETCH_ENDPOINT = "/api/fetch-url";

export interface SaveUrlOptions {
  tags?: string[];
}

async function cacheArticleHtml(url: string, globalId: string, html: string): Promise<void> {
  if (!("caches" in window)) return;

  const cache = await caches.open("freed-articles-v1");
  await cache.put(url, new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));
  await cache.put(`/content/${globalId}`, new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));
}

async function fetchArticleHtml(url: string): Promise<string> {
  const response = await fetch(FETCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(20_000),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || "Failed to fetch article HTML");
  }
  return body;
}

export async function saveUrlInPwa(
  url: string,
  options: SaveUrlOptions = {},
): Promise<void> {
  let stableUrl: string;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http and https URLs are supported");
    }
    stableUrl = parsed.toString();
  } catch {
    throw new Error("Invalid URL");
  }

  try {
    const rawHtml = await fetchArticleHtml(stableUrl);
    const metadata = extractMetadataBrowser(rawHtml, stableUrl);
    const content = extractContentBrowser(rawHtml, stableUrl);
    const item = buildSavedFeedItem(metadata, content, {
      tags: options.tags,
      includeSourceUrl: true,
      includePriorityFields: true,
    });

    await cacheArticleHtml(stableUrl, item.globalId, content.html);
    await docAddFeedItem(item);
    return;
  } catch {
    await docAddStubItem(stableUrl, options.tags);
    toast.info("Saved a stub. Full article content will arrive after your next desktop sync.");
  }
}
