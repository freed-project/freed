import { JSDOM } from "jsdom";
import type { UrlMetadata } from "./types.js";

/**
 * Extract metadata from a URL using Open Graph and meta tags
 */
export async function extractMetadata(url: string): Promise<UrlMetadata> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const title =
    getMetaContent(doc, 'meta[property="og:title"]') ||
    getMetaContent(doc, 'meta[name="title"]') ||
    doc.querySelector("title")?.textContent ||
    url;

  const description =
    getMetaContent(doc, 'meta[property="og:description"]') ||
    getMetaContent(doc, 'meta[name="description"]');

  const imageUrl =
    getMetaContent(doc, 'meta[property="og:image"]') ||
    getMetaContent(doc, 'meta[name="twitter:image"]');

  const siteName =
    getMetaContent(doc, 'meta[property="og:site_name"]') ||
    new URL(url).hostname;

  const author =
    getMetaContent(doc, 'meta[name="author"]') ||
    getMetaContent(doc, 'meta[property="article:author"]');

  const publishedTimeStr =
    getMetaContent(doc, 'meta[property="article:published_time"]') ||
    getMetaContent(doc, 'meta[name="date"]');

  const publishedAt = publishedTimeStr
    ? new Date(publishedTimeStr).getTime()
    : undefined;

  const type = getMetaContent(doc, 'meta[property="og:type"]');

  return {
    url,
    title: title.trim(),
    description: description?.trim(),
    imageUrl,
    siteName,
    author: author?.trim(),
    publishedAt,
    type,
  };
}

function getMetaContent(doc: Document, selector: string): string | undefined {
  const el = doc.querySelector(selector);
  return el?.getAttribute("content") || undefined;
}
