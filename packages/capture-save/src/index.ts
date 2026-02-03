/**
 * @freed/capture-save - Save any URL to your Freed library
 */

export { extractMetadata } from "./extract.js";
export { extractContent } from "./readability.js";
export { urlToFeedItem } from "./normalize.js";
export type { UrlMetadata, ExtractedContent, SaveOptions } from "./types.js";

import type { FeedItem } from "@freed/shared";
import { extractMetadata } from "./extract.js";
import { extractContent } from "./readability.js";
import { urlToFeedItem } from "./normalize.js";
import type { SaveOptions } from "./types.js";

/**
 * Save a URL to Freed with full article extraction
 *
 * @param url - URL to save
 * @param options - Save options (tags, metadataOnly)
 * @returns FeedItem ready to be added to the Automerge document
 */
export async function saveUrl(
  url: string,
  options: SaveOptions = {}
): Promise<FeedItem> {
  // Always extract metadata
  const metadata = await extractMetadata(url);

  // Extract full content unless metadataOnly is set
  let content = null;
  if (!options.metadataOnly) {
    try {
      content = await extractContent(url);
    } catch (error) {
      // Fall back to metadata-only if content extraction fails
      console.warn(`Content extraction failed for ${url}:`, error);
    }
  }

  return urlToFeedItem(metadata, content, options);
}
