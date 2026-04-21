import type { FeedItem, PreservedContent } from "@freed/shared";
import type { UrlMetadata, ExtractedContent, SaveOptions } from "./types.js";

export interface BuildSavedFeedItemOptions {
  tags?: string[];
  includeHtmlInPreservedContent?: boolean;
  includeSourceUrl?: boolean;
  includePriorityFields?: boolean;
  preservedText?: string;
  now?: number;
}

function hostnameForUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Convert extracted URL data to a FeedItem
 */
export function urlToFeedItem(
  metadata: UrlMetadata,
  content: ExtractedContent | null,
  options: SaveOptions = {},
): FeedItem {
  return buildSavedFeedItem(metadata, content, {
    tags: options.tags,
    includeHtmlInPreservedContent: true,
    includeSourceUrl: true,
    includePriorityFields: true,
  });
}

/**
 * Create a short hash of a URL for use as an ID
 */
export function hashSavedUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

export function buildSavedFeedItem(
  metadata: UrlMetadata,
  content: ExtractedContent | null,
  options: BuildSavedFeedItemOptions = {},
): FeedItem {
  const now = options.now ?? Date.now();
  const hostname = metadata.siteName ?? hostnameForUrl(metadata.url);

  const preservedContent: PreservedContent | undefined = content
    ? {
        ...(options.includeHtmlInPreservedContent ? { html: content.html } : {}),
        text: options.preservedText ?? content.text,
        author: content.author || metadata.author,
        publishedAt: metadata.publishedAt,
        wordCount: content.wordCount,
        readingTime: content.readingTime,
        preservedAt: now,
      }
    : undefined;

  return {
    globalId: `saved:${hashSavedUrl(metadata.url)}`,
    platform: "saved",
    contentType: "article",
    capturedAt: now,
    publishedAt: metadata.publishedAt ?? now,
    author: {
      id: hostname,
      handle: hostname,
      displayName: hostname,
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
    ...(options.includeSourceUrl ? { sourceUrl: metadata.url } : {}),
    userState: {
      hidden: false,
      saved: true,
      savedAt: now,
      archived: false,
      tags: options.tags ?? [],
    },
    topics: [],
    ...(options.includePriorityFields
      ? {
          priority: 50,
          priorityComputedAt: now,
        }
      : {}),
  };
}
