/**
 * Batch import/export of Freed Markdown library archives
 *
 * Import pipeline:
 *  Phase 1 "scanning" reads and parses each Markdown file.
 *  Phase 2 "writing" submits typed SQLite import mutations.
 *  Phase 3 "caching" writes full HTML to the device content cache.
 *  Phase 4 "fetching" enqueues bodyless stubs for background fetch.
 *
 * Export visits bounded SQLite pages and releases each page before requesting
 * the next one. Archive assembly never reconstructs the FeedItem corpus.
 */

import { parseMarkdownArchiveFile } from "@freed/capture-save/import-markdown";
import { exportLibraryAsMarkdown } from "@freed/capture-save/export-markdown";
import type { FeedItem } from "@freed/shared";
import type { ScanLibraryItems } from "@freed/ui/context";
import { contentCache } from "./content-cache.js";
import { importLibraryItems } from "./library-client";
import { enqueue as enqueueFetch } from "./content-fetcher.js";

const IMPORT_SOURCE_FILE_BATCH = 128;

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

  const totalBatches = Math.ceil(mdFiles.length / IMPORT_SOURCE_FILE_BATCH);
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * IMPORT_SOURCE_FILE_BATCH;
    const batchFiles = mdFiles.slice(start, start + IMPORT_SOURCE_FILE_BATCH);
    const parsed = new Map<string, { item: FeedItem; html: string | null }>();

    for (let offset = 0; offset < batchFiles.length; offset++) {
      const file = batchFiles[offset];
      emit("scanning", start + offset + 1, mdFiles.length);
      try {
        const content = await file.text();
        const result = parseMarkdownArchiveFile(
          file.name,
          content,
          file.webkitRelativePath || undefined,
        );
        if (!result) {
          errors.push(`${file.name}: could not parse`);
          skipped++;
          continue;
        }
        if (parsed.has(result.item.globalId)) skipped++;
        parsed.set(result.item.globalId, {
          item: result.item,
          html: result.html ?? null,
        });
      } catch (err) {
        errors.push(
          `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        skipped++;
      }
    }

    const candidates = [...parsed.values()];
    emit("writing", batchIndex, totalBatches);
    const insertedIds = new Set(
      candidates.length === 0
        ? []
        : await importLibraryItems(candidates.map(({ item }) => item)),
    );
    imported += insertedIds.size;
    skipped += candidates.length - insertedIds.size;
    emit("writing", batchIndex + 1, totalBatches);

    const inserted = candidates.filter(({ item }) =>
      insertedIds.has(item.globalId),
    );
    const cacheEntries = inserted.filter(
      (entry): entry is { item: FeedItem; html: string } => entry.html !== null,
    );
    if (cacheEntries.length > 0) {
      emit("caching", 0, cacheEntries.length);
      await Promise.all(
        cacheEntries.map(({ item, html }) =>
          contentCache.set(item.globalId, html).catch((err: unknown) => {
            console.warn(
              `[import-export] Failed to cache HTML for ${item.globalId}:`,
              err,
            );
          }),
        ),
      );
      emit("caching", cacheEntries.length, cacheEntries.length);
    }

    const stubs = inserted
      .filter(
        ({ html, item }) =>
          html === null && Boolean(item.content.linkPreview?.url),
      )
      .map(({ item }) => item);
    if (stubs.length > 0) {
      emit("fetching", 0, stubs.length);
      enqueueFetch(stubs);
      emit("fetching", stubs.length, stubs.length);
    }
  }

  return { imported, skipped, errors };
}

/**
 * Export the full library as a Freed Markdown zip archive.
 *
 * Reads HTML from the device content cache for each item (full content included
 * where available). Triggers a browser download of the zip file.
 */
export async function exportLibrary(
  scanItems: ScanLibraryItems,
): Promise<void> {
  const blob = await exportLibraryAsMarkdown(scanItems, (id: string) =>
    contentCache.get(id),
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
