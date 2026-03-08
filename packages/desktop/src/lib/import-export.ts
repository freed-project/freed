/**
 * Batch import/export of Freed Markdown library archives
 *
 * Import pipeline:
 *  Phase 1 "scanning"  – read + parse each .md file, check against existingIds
 *  Phase 2 "writing"   – write new items to Automerge in 500-item chunks
 *  Phase 3 "caching"   – write full HTML to the device content cache in parallel
 *  Phase 4 "fetching"  – enqueue stub items (no body) for background fetch
 *
 * Export: read FeedItems from Automerge → read HTML from content cache → zip.
 */

import { parseMarkdownArchiveFile } from "@freed/capture-save/import-markdown";
import { exportLibraryAsMarkdown } from "@freed/capture-save/export-markdown";
import type { FeedItem } from "@freed/shared";
import { contentCache } from "./content-cache.js";
import { docBatchImportItems } from "./automerge.js";
import { useAppStore } from "./store.js";
import { enqueue as enqueueFetch } from "./content-fetcher.js";

export type ImportPhase = "scanning" | "writing" | "caching" | "fetching";

export interface ImportProgress {
  phase: ImportPhase;
  /** Total units in the current phase (files during scanning, chunks during writing) */
  total: number;
  /** Units completed in the current phase */
  current: number;
  /** Running count of items successfully imported so far */
  imported: number;
  /** Running count of items skipped (already exist, unparseable, or within-batch dup) */
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
 * When files come from a `webkitdirectory` input each `File` has a
 * `webkitRelativePath` (e.g. "my-export/articles/tech/post.md"). The
 * intermediate folder segments are forwarded to `parseMarkdownArchiveFile`
 * and merged as hierarchical tags so the folder structure is reconstructable
 * later via the sidebar tag tree.
 *
 * @param files      FileList from a folder picker or multi-file input
 * @param onProgress Optional progress callback fired at every meaningful transition
 */
export async function importMarkdownFiles(
  files: FileList,
  onProgress?: ProgressFn,
): Promise<ImportSummary> {
  const mdFiles = Array.from(files).filter((f) => f.name.endsWith(".md"));

  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  /** Emit a snapshot of current state for a given phase */
  const emit = (phase: ImportPhase, current: number, total: number) => {
    onProgress?.({ phase, total, current, imported, skipped, errors });
  };

  // ── Phase 1: Scanning ──────────────────────────────────────────────────────
  // Snapshot existing globalIds once upfront — O(1) per lookup vs O(n) Automerge reads.
  // This is the primary deduplication gate; docBatchImportItems has a secondary guard
  // inside the CRDT change for within-batch duplicates.
  // allItemIds includes hidden/archived items — see DocState.allItemIds
  const existingIds = new Set(useAppStore.getState().allItemIds);

  const parsedItems: FeedItem[] = [];
  const htmlMap = new Map<string, string>(); // globalId → html
  const stubItems: FeedItem[] = [];

  for (let i = 0; i < mdFiles.length; i++) {
    const file = mdFiles[i];
    emit("scanning", i + 1, mdFiles.length);

    try {
      const content = await file.text();
      // webkitRelativePath is set for folder-picker files; empty string otherwise
      const relativePath = file.webkitRelativePath || undefined;
      const result = parseMarkdownArchiveFile(file.name, content, relativePath);

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
      imported++;

      if (result.html) {
        htmlMap.set(result.item.globalId, result.html);
      } else {
        // Stub: no body, needs background fetch
        const url = result.item.content.linkPreview?.url;
        if (url) stubItems.push(result.item);
      }
    } catch (err) {
      errors.push(
        `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      skipped++;
    }
  }

  // ── Phase 2: Writing to Automerge ─────────────────────────────────────────

  if (parsedItems.length > 0) {
    const totalChunks = Math.ceil(parsedItems.length / 500);
    emit("writing", 0, totalChunks);
    await docBatchImportItems(parsedItems, (chunkDone, totalChunks_) => {
      emit("writing", chunkDone, totalChunks_);
    });
  }

  // ── Phase 3: Caching HTML ─────────────────────────────────────────────────

  if (htmlMap.size > 0) {
    emit("caching", 0, htmlMap.size);
    const cacheWrites = Array.from(htmlMap.entries()).map(([id, html]) =>
      contentCache.set(id, html).catch((err: unknown) => {
        console.warn(`[import-export] Failed to cache HTML for ${id}:`, err);
      }),
    );
    await Promise.all(cacheWrites);
    emit("caching", htmlMap.size, htmlMap.size);
  }

  // ── Phase 4: Enqueue stubs for background fetch ───────────────────────────

  if (stubItems.length > 0) {
    emit("fetching", 0, stubItems.length);
    enqueueFetch(stubItems);
    emit("fetching", stubItems.length, stubItems.length);
  }

  return { imported, skipped, errors };
}

/**
 * Export the full library as a Freed Markdown zip archive.
 *
 * Reads HTML from the device content cache for each item (full content included
 * where available). Triggers a browser download of the zip file.
 */
export async function exportLibrary(items: FeedItem[]): Promise<void> {
  const blob = await exportLibraryAsMarkdown(
    items,
    (id: string) => contentCache.get(id),
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freed-library-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
