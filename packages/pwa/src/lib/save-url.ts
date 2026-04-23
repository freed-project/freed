import {
  extractContentBrowser,
  extractMetadataBrowser,
} from "@freed/capture-save/browser";
import { buildSavedFeedItem } from "@freed/capture-save/normalize";
import { cacheArticleHtml, warmArticleImageCache } from "@freed/ui/lib/article-cache";
import { toast } from "@freed/ui/components/Toast";
import { docAddFeedItem, docAddStubItem } from "./automerge";

const FETCH_ENDPOINT = "/api/fetch-url";

export interface SaveUrlOptions {
  tags?: string[];
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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  const stableUrl = parsed.toString();
  let articleHtml: string;
  let item: ReturnType<typeof buildSavedFeedItem>;

  try {
    const rawHtml = await fetchArticleHtml(stableUrl);
    const metadata = extractMetadataBrowser(rawHtml, stableUrl);
    const content = extractContentBrowser(rawHtml, stableUrl);
    item = buildSavedFeedItem(metadata, content, {
      tags: options.tags,
      includeSourceUrl: true,
      includePriorityFields: true,
    });
    articleHtml = content.html;
  } catch {
    await docAddStubItem(stableUrl, options.tags);
    toast.info("Saved a stub. Full article content will arrive after your next desktop sync.");
    return;
  }

  await cacheArticleHtml(stableUrl, item.globalId, articleHtml);
  void warmArticleImageCache(articleHtml, stableUrl);
  await docAddFeedItem(item);
}
