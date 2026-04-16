/**
 * Desktop URL save flow
 *
 * Architecture:
 *  1. Fetch raw HTML via `fetch_url` Tauri IPC (bypasses CORS + uses native HTTP)
 *  2. Extract metadata + article content in the renderer (DOMParser + Readability)
 *  3. Write full HTML to the device content cache (Layer 2 -- NOT Automerge)
 *  4. Build a FeedItem with only preservedContent.text (no html) in Automerge
 *  5. Write the item to Automerge via docAddFeedItem()
 */

import { invoke } from "@tauri-apps/api/core";
import {
  extractMetadataBrowser,
  extractContentBrowser,
} from "@freed/capture-save/browser";
import type { FeedItem } from "@freed/shared";
import { contentCache } from "./content-cache.js";
import { docAddFeedItem } from "./automerge.js";
import { toSyncedPreservedText } from "./preserved-text.js";

export interface SaveUrlOptions {
  tags?: string[];
}

/** Stable 32-bit hash of a string encoded as base-36 */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Save a URL to the Freed desktop library.
 *
 * Fetches, extracts, caches HTML locally, then writes metadata to Automerge.
 * Full HTML never touches Automerge -- that keeps the CRDT small and sync fast.
 */
export async function saveUrlInDesktop(
  url: string,
  options: SaveUrlOptions = {},
): Promise<FeedItem> {
  // Step 1: Fetch raw HTML via Tauri IPC
  const html = await invoke<string>("fetch_url", { url });

  // Step 2: Extract metadata and content in the renderer (browser-safe)
  const metadata = extractMetadataBrowser(html, url);
  const content = extractContentBrowser(html, url);

  const now = Date.now();
  const globalId = `saved:${hashUrl(url)}`;

  // Step 3: Write Readability-extracted article HTML to device content cache.
  // Intentionally NOT the raw page HTML -- that contains <style>, <script>,
  // and other full-page elements that would leak into the app DOM.
  await contentCache.set(globalId, content.html);

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // malformed URL
  }

  // Step 4: Build item with text-only preservedContent (Automerge-safe)
  const item: FeedItem = {
    globalId,
    platform: "saved",
    contentType: "article",
    capturedAt: now,
    publishedAt: metadata.publishedAt ?? now,
    author: {
      id: metadata.siteName ?? hostname,
      handle: hostname,
      displayName: metadata.siteName ?? hostname,
    },
    content: {
      text: metadata.description ?? content.text.slice(0, 300),
      mediaUrls: metadata.imageUrl ? [metadata.imageUrl] : [],
      mediaTypes: metadata.imageUrl ? ["image"] : [],
      linkPreview: {
        url,
        title: metadata.title,
        description: metadata.description,
      },
    },
    preservedContent: {
      // html intentionally omitted -- it lives in contentCache only
      text: toSyncedPreservedText(content.text),
      author: content.author ?? metadata.author,
      publishedAt: metadata.publishedAt,
      wordCount: content.wordCount,
      readingTime: content.readingTime,
      preservedAt: now,
    },
    userState: {
      hidden: false,
      saved: true,
      savedAt: now,
      archived: false,
      tags: options.tags ?? [],
    },
    topics: [],
  };

  // Step 5: Write to Automerge (syncs to all devices via relay)
  await docAddFeedItem(item);

  return item;
}
