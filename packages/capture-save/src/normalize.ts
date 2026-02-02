import type { FeedItem, PreservedContent } from "@freed/shared";
import type { UrlMetadata, ExtractedContent, SaveOptions } from "./types.js";

/**
 * Convert extracted URL data to a FeedItem
 */
export function urlToFeedItem(
  metadata: UrlMetadata,
  content: ExtractedContent | null,
  options: SaveOptions = {},
): FeedItem {
  const now = Date.now();

  // Build preserved content if we have full extraction
  const preservedContent: PreservedContent | undefined = content
    ? {
        html: content.html,
        text: content.text,
        author: content.author || metadata.author,
        publishedAt: metadata.publishedAt,
        wordCount: content.wordCount,
        readingTime: content.readingTime,
        preservedAt: now,
      }
    : undefined;

  // Generate a URL-safe ID
  const urlHash = hashUrl(metadata.url);

  return {
    globalId: `saved:${urlHash}`,
    platform: "saved",
    contentType: "article",
    capturedAt: now,
    publishedAt: metadata.publishedAt ?? now,
    author: {
      id: metadata.siteName ?? new URL(metadata.url).hostname,
      handle: new URL(metadata.url).hostname,
      displayName: metadata.siteName ?? new URL(metadata.url).hostname,
    },
    content: {
      text: metadata.description ?? content?.text.slice(0, 300) ?? "",
      mediaUrls: metadata.imageUrl ? [metadata.imageUrl] : [],
      mediaTypes: metadata.imageUrl ? ["image"] : [],
      linkPreview: {
        url: metadata.url,
        title: metadata.title,
        description: metadata.description,
      },
    },
    preservedContent,
    userState: {
      hidden: false,
      saved: true,
      savedAt: now,
      archived: false,
      tags: options.tags ?? [],
    },
    topics: [],
    priority: 50, // Default priority, will be recalculated by ranking
    priorityComputedAt: now,
  };
}

/**
 * Create a short hash of a URL for use as an ID
 */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}
