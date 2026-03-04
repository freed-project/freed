/**
 * Browser-safe content extraction for Tauri WebView / PWA renderer
 *
 * Uses DOMParser (available in all browser contexts) instead of JSDOM, which
 * is a Node.js-only dependency. This module is safe to import in the Tauri
 * renderer process and in the PWA service worker.
 */

import { Readability } from "@mozilla/readability";
import type { UrlMetadata, ExtractedContent } from "./types.js";

/**
 * Extract Open Graph / meta tag metadata from raw HTML using DOMParser.
 * No network request — caller is responsible for fetching the HTML.
 */
export function extractMetadataBrowser(html: string, url: string): UrlMetadata {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const get = (selector: string): string | undefined =>
    doc.querySelector(selector)?.getAttribute("content") ?? undefined;

  const title =
    get('meta[property="og:title"]') ||
    get('meta[name="title"]') ||
    doc.querySelector("title")?.textContent?.trim() ||
    url;

  const description =
    get('meta[property="og:description"]') ||
    get('meta[name="description"]');

  const imageUrl =
    get('meta[property="og:image"]') ||
    get('meta[name="twitter:image"]');

  let siteName: string | undefined;
  try {
    siteName = get('meta[property="og:site_name"]') ?? new URL(url).hostname;
  } catch {
    siteName = undefined;
  }

  const author =
    get('meta[name="author"]') ||
    get('meta[property="article:author"]');

  const publishedTimeStr =
    get('meta[property="article:published_time"]') ||
    get('meta[name="date"]');

  const publishedAt = publishedTimeStr
    ? new Date(publishedTimeStr).getTime()
    : undefined;

  const type = get('meta[property="og:type"]');

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

/**
 * Extract article content from raw HTML using Mozilla Readability + DOMParser.
 *
 * Returns both `html` (for the device-local content cache) and `text` (for
 * Automerge sync). The caller decides which layers each goes to -- never put
 * `html` into Automerge directly.
 */
export function extractContentBrowser(html: string, url: string): ExtractedContent {
  // DOMParser preserves the base URL for relative links via the <base> element.
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Inject a base element so Readability resolves relative URLs correctly.
  if (!doc.querySelector("base")) {
    const base = doc.createElement("base");
    base.href = url;
    doc.head.prepend(base);
  }

  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) {
    throw new Error(`Readability could not extract content from ${url}`);
  }

  const text = article.textContent.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  return {
    html: article.content,
    text,
    wordCount,
    readingTime,
    title: article.title || undefined,
    author: article.byline || undefined,
  };
}
