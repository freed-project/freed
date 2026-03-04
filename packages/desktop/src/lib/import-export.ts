/**
 * Batch import/export of Freed Markdown library archives
 *
 * Import: parse FileList → write to Automerge in 500-item chunks → write HTML
 *   to content cache in parallel → enqueue stubs for background fetch.
 *
 * Export: read FeedItems from Automerge → read HTML from content cache → zip.
 */

import { parseMarkdownArchiveFile } from "@freed/capture-save/import-markdown";
import { exportLibraryAsMarkdown } from "@freed/capture-save/export-markdown";
import type { FeedItem } from "@freed/shared";
import { contentCache } from "./content-cache.js";
import { docBatchImportItems, getDoc } from "./automerge.js";
import { enqueue as enqueueFetch } from "./content-fetcher.js";

export interface ImportProgress {
  total: number;
  current: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export type ProgressFn = (progress: ImportProgress) => void;

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Import a FileList of Freed Markdown archive files.
 *
 * Strategy:
 *  1. Filter to .md files only
 *  2. Parse each file with parseMarkdownArchiveFile()
 *  3. Write parsed items to Automerge in batches of 500
 *  4. Write HTML (for items with bodies) to content cache in parallel
 *  5. Enqueue stub items (no body) for background content fetch
 *
 * @param files - The FileList from a file picker input
 * @param onProgress - Optional progress callback
 */
export async function importMarkdownFiles(
  files: FileList,
  onProgress?: ProgressFn,
): Promise<ImportSummary> {
  const mdFiles = Array.from(files).filter((f) => f.name.endsWith(".md"));
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  const progress: ImportProgress = {
    total: mdFiles.length,
    current: 0,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  // Get existing globalIds to skip duplicates without hitting Automerge for each
  const existingIds = new Set(Object.keys(getDoc().feedItems ?? {}));

  // Parse all files first (synchronous, fast) to collect items + html blobs
  const parsedItems: FeedItem[] = [];
  const htmlMap = new Map<string, string>(); // globalId → html
  const stubItems: FeedItem[] = [];

  for (const file of mdFiles) {
    progress.current++;
    onProgress?.(progress);

    try {
      const content = await file.text();
      const result = parseMarkdownArchiveFile(file.name, content);

      if (!result) {
        errors.push(`${file.name}: could not parse`);
        skipped++;
        continue;
      }

      if (existingIds.has(result.item.globalId)) {
        skipped++;
        continue;
      }

      parsedItems.push(result.item);

      if (result.html) {
        htmlMap.set(result.item.globalId, result.html);
      } else {
        // No body -- needs background fetch
        const url = result.item.content.linkPreview?.url;
        if (url) stubItems.push(result.item);
      }
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  // Batch write to Automerge (chunked at 500 to avoid huge CRDT changes)
  if (parsedItems.length > 0) {
    await docBatchImportItems(parsedItems);
    imported = parsedItems.length;
  }

  // Write HTML to content cache in parallel (not in Automerge)
  const cacheWrites = Array.from(htmlMap.entries()).map(([id, html]) =>
    contentCache.set(id, html).catch((err: unknown) => {
      console.warn(`[import-export] Failed to cache HTML for ${id}:`, err);
    }),
  );
  await Promise.all(cacheWrites);

  // Enqueue stubs for background fetch
  if (stubItems.length > 0) {
    enqueueFetch(stubItems);
  }

  return { imported, skipped, errors };
}

/**
 * Export the full library as a Freed Markdown zip archive.
 *
 * Reads HTML from the device content cache for each item (so full content is
 * included where available). Triggers a browser download of the zip file.
 */
export async function exportLibrary(items: FeedItem[]): Promise<void> {
  const blob = await exportLibraryAsMarkdown(
    items,
    (id) => contentCache.get(id),
  );

  // Trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freed-library-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
