import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { ExtractedContent } from "./types.js";

/**
 * Extract article content using Mozilla Readability
 */
export async function extractContent(url: string): Promise<ExtractedContent> {
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

  // Clone the document for Readability (it modifies the DOM)
  const documentClone = dom.window.document.cloneNode(true) as Document;
  const reader = new Readability(documentClone);
  const article = reader.parse();

  if (!article) {
    throw new Error(`Could not extract article content from ${url}`);
  }

  const text = article.textContent.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200)); // 200 WPM

  return {
    html: article.content,
    text,
    wordCount,
    readingTime,
    title: article.title || undefined,
    author: article.byline || undefined,
  };
}
