/**
 * Freed Markdown archive importer
 *
 * Parses Freed Markdown archive files into FeedItems. The format is a
 * superset of standard Markdown with YAML frontmatter:
 *
 * ```markdown
 * ---
 * title: Article Title
 * tags:
 *   - "Technology/AI"
 * createdAt: Tue Aug 26 2025 12:09:30 GMT-0700 (Pacific Daylight Time)
 * updatedAt: Tue Aug 26 2025 12:09:31 GMT-0700 (Pacific Daylight Time)
 * ---
 *
 * [optional article summary body]
 *
 * ## Sources
 *
 * - [website](https://example.com)
 * ```
 *
 * Stub files (no body, just a Sources section) are queued for background fetch.
 * Files with summary bodies store text in preservedContent.text for Automerge sync.
 */

import { marked } from "marked";
import type { FeedItem } from "@freed/shared";

export interface ParsedArchiveFile {
  /** The FeedItem ready to be written to Automerge (no html in preservedContent) */
  item: FeedItem;
  /**
   * Full article HTML converted from the body markdown.
   * Write to the device content cache (not Automerge).
   * null for stub files with no body.
   */
  html: string | null;
}

/** Stable 32-bit hash of a string, encoded as a base-36 number */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract the first source URL from a Freed Markdown ## Sources block.
 * Returns null if no Sources section or no valid URL found.
 */
function extractSourceUrl(body: string): string | null {
  const sourcesMatch = body.match(/^##\s+Sources\s*\n([\s\S]*?)(?=\n##\s|\s*$)/im);
  if (!sourcesMatch) return null;

  const linkMatch = sourcesMatch[1].match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
  return linkMatch ? linkMatch[1] : null;
}

/**
 * Strip the ## Sources section from a markdown body.
 * Returns the cleaned body text.
 */
function stripSourcesSection(body: string): string {
  return body.replace(/^##\s+Sources\s*\n[\s\S]*?(?=\n##\s|\s*$)/im, "").trim();
}

/**
 * Parse a single Freed Markdown archive file.
 *
 * @param filename - Original filename (used for error context only)
 * @param content - Raw file content string
 * @returns Parsed item + optional HTML, or null if the file cannot be parsed
 */
export function parseMarkdownArchiveFile(
  filename: string,
  content: string,
): ParsedArchiveFile | null {
  // Extract YAML frontmatter between the first two --- delimiters.
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    console.warn(`[import-markdown] No frontmatter in ${filename}`);
    return null;
  }

  const [, frontmatter, rawBody] = fmMatch;

  // Parse frontmatter fields with simple regex (avoids a YAML dep).
  const title = frontmatter.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? filename;

  const url = frontmatter.match(/^url:\s*(.+)$/m)?.[1]?.trim();

  const createdAtStr = frontmatter.match(/^createdAt:\s*(.+)$/m)?.[1]?.trim();
  const capturedAt = createdAtStr ? new Date(createdAtStr).getTime() : Date.now();

  const publishedAtStr = frontmatter.match(/^publishedAt:\s*(.+)$/m)?.[1]?.trim();
  const publishedAt = publishedAtStr ? new Date(publishedAtStr).getTime() : capturedAt;

  const author = frontmatter.match(/^author:\s*(.+)$/m)?.[1]?.trim();
  const platform = frontmatter.match(/^platform:\s*(.+)$/m)?.[1]?.trim() ?? "saved";

  // Tags: YAML list format (  - "Tag/Path")
  const tags: string[] = [];
  const tagsMatch = frontmatter.match(/^tags:\s*\n((?:\s+-\s+.*\n?)*)/m);
  if (tagsMatch) {
    for (const line of tagsMatch[1].split("\n")) {
      const tag = line.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim();
      if (tag) tags.push(tag);
    }
  }

  // Word count / reading time from frontmatter (lossless round-trip from export)
  const wordCountRaw = frontmatter.match(/^wordCount:\s*(\d+)/m)?.[1];
  const readingTimeRaw = frontmatter.match(/^readingTime:\s*(\d+)/m)?.[1];

  // Extract the source URL: prefer frontmatter `url`, then ## Sources block
  const sourceUrl = url ?? extractSourceUrl(rawBody);

  // Generate a stable globalId from the URL or title
  const idKey = sourceUrl ?? title;
  const globalId = `saved:${hashString(idKey)}`;

  // Determine body content (body minus the Sources section)
  const bodyText = stripSourcesSection(rawBody);
  const hasBody = bodyText.length > 0;

  // Convert body markdown to HTML for the local content cache.
  // Stub files (no body) return null -- they'll be background-fetched later.
  const html = hasBody ? (marked.parse(bodyText) as string) : null;

  // Plain text for Automerge (trim to reasonable size)
  const text = bodyText.slice(0, 10_000);
  const wordCount = wordCountRaw
    ? parseInt(wordCountRaw, 10)
    : text.split(/\s+/).filter(Boolean).length;
  const readingTime = readingTimeRaw
    ? parseInt(readingTimeRaw, 10)
    : Math.max(1, Math.ceil(wordCount / 200));

  const now = Date.now();

  const item: FeedItem = {
    globalId,
    platform: platform as FeedItem["platform"],
    contentType: "article",
    capturedAt: isNaN(capturedAt) ? now : capturedAt,
    publishedAt: isNaN(publishedAt) ? now : publishedAt,
    author: {
      id: sourceUrl ? new URL(sourceUrl).hostname : "unknown",
      handle: sourceUrl ? new URL(sourceUrl).hostname : "unknown",
      displayName: author ?? (sourceUrl ? new URL(sourceUrl).hostname : "Unknown"),
      avatarUrl: undefined,
    },
    content: {
      text: text.slice(0, 300),
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: sourceUrl
        ? { url: sourceUrl, title }
        : undefined,
    },
    preservedContent: hasBody
      ? {
          // html intentionally omitted -- goes to content cache only
          text,
          author,
          wordCount,
          readingTime,
          preservedAt: now,
        }
      : undefined,
    userState: {
      hidden: false,
      saved: true,
      savedAt: now,
      archived: false,
      tags,
    },
    topics: [],
  };

  // Silence the URL constructor errors for stub files with no URL
  try {
    if (!sourceUrl) {
      item.author.id = "unknown";
      item.author.handle = "unknown";
      item.author.displayName = author ?? title;
    }
  } catch {
    // Already handled above
  }

  return { item, html };
}
