/**
 * Freed Markdown archive exporter
 *
 * Serializes FeedItems to the Freed Markdown format and bundles them into a
 * zip archive via JSZip. The format is a lossless superset of the import
 * format -- it adds `url`, `platform`, `capturedAt`, `author`, `wordCount`,
 * and `readingTime` so round-trip imports reconstruct the same metadata.
 *
 * ZIP layout: `{firstTagSegment}/{sanitizedTitle}.md`
 * Items with no tags land in `Unsorted/{sanitizedTitle}.md`.
 */

import JSZip from "jszip";
import type { FeedItem } from "@freed/shared";

/** Sanitize a string for use as a filesystem path segment */
function sanitizePath(str: string): string {
  return str
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Serialize a single FeedItem to Freed Markdown format.
 *
 * @param item - The FeedItem to serialize
 * @param html - Optional full HTML content (from device content cache). When
 *   provided the body is omitted in favor of the HTML (format uses markdown
 *   summary text, not raw HTML). Pass the result of preservedContent.text
 *   if no HTML is available.
 * @returns { directory, filename, content } ready to be written into a zip
 */
export function feedItemToMarkdown(
  item: FeedItem,
  text?: string | null,
): { directory: string; filename: string; content: string } {
  const firstTag = item.userState.tags[0];
  const directory = firstTag
    ? sanitizePath(firstTag.split("/")[0])
    : "Unsorted";

  const title = item.content.linkPreview?.title ?? (item.content.text?.slice(0, 80)) ?? "Untitled";
  const filename = `${sanitizePath(title)}.md`;

  const sourceUrl = item.content.linkPreview?.url;
  const pc = item.preservedContent;

  const tagLines = item.userState.tags.map((t) => `  - "${t}"`).join("\n");
  const tagsBlock = item.userState.tags.length > 0 ? `tags:\n${tagLines}\n` : "";

  const frontmatter = [
    "---",
    `title: ${title}`,
    sourceUrl ? `url: ${sourceUrl}` : null,
    tagsBlock || null,
    `platform: ${item.platform}`,
    `capturedAt: ${new Date(item.capturedAt).toISOString()}`,
    item.publishedAt ? `publishedAt: ${new Date(item.publishedAt).toISOString()}` : null,
    item.author.displayName ? `author: ${item.author.displayName}` : null,
    pc?.wordCount ? `wordCount: ${pc.wordCount}` : null,
    pc?.readingTime ? `readingTime: ${pc.readingTime}` : null,
    "---",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  // Body: use preservedContent.text or the passed text, stripped to a sensible length
  const bodyText = text ?? pc?.text ?? "";
  const body = bodyText.trim();

  const sourcesSection = sourceUrl
    ? `\n\n## Sources\n\n- [website](${sourceUrl})`
    : "";

  const content = body
    ? `${frontmatter}\n\n${body}${sourcesSection}\n`
    : `${frontmatter}${sourcesSection}\n`;

  return { directory, filename, content };
}

/**
 * Export an array of FeedItems as a zipped Freed Markdown archive.
 *
 * @param items - Items to export
 * @param getHtml - Async function that fetches HTML from the device content
 *   cache for a given globalId. Returns null when no cached HTML is available.
 * @returns A Blob containing the zip archive
 */
export async function exportLibraryAsMarkdown(
  items: FeedItem[],
  getHtml: (globalId: string) => Promise<string | null>,
): Promise<Blob> {
  const zip = new JSZip();

  // Track used paths to avoid collisions (append index when needed)
  const usedPaths = new Map<string, number>();

  await Promise.all(
    items.map(async (item) => {
      // Prefer cached HTML text content; fall back to preservedContent.text
      const html = await getHtml(item.globalId);
      // For the markdown body, use preservedContent.text regardless of html presence
      const text = item.preservedContent?.text ?? null;

      const { directory, filename, content } = feedItemToMarkdown(item, text);
      const basePath = `${directory}/${filename}`;

      // Deduplicate paths
      const count = usedPaths.get(basePath) ?? 0;
      usedPaths.set(basePath, count + 1);
      const finalPath = count === 0 ? basePath : `${directory}/${filename.replace(/\.md$/, "")} (${count}).md`;

      zip.file(finalPath, content);

      // If we have cached HTML, bundle it alongside the markdown
      if (html) {
        const htmlPath = finalPath.replace(/\.md$/, ".html");
        zip.file(htmlPath, html);
      }
    }),
  );

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
