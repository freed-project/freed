/**
 * Filesystem-backed HTML content cache for desktop
 *
 * Stores full article HTML at `{appDataDir}/content/{globalId}.html` via the
 * Tauri FS plugin. This is Layer 2 of the sync architecture -- device-local,
 * never synced via Automerge.
 *
 * Keys are globalIds (e.g. "saved:abc123", "rss:xyz789"). The globalId is
 * used as-is as a filename; characters that are unsafe for filesystems are
 * replaced with underscores.
 */

import { appDataDir } from "@tauri-apps/api/path";
import {
  readTextFile,
  writeTextFile,
  remove,
  exists,
  mkdir,
  readDir,
  size,
} from "@tauri-apps/plugin-fs";

// Cached base directory path to avoid repeated IPC calls
let _contentDir: string | null = null;
export const MAX_CONTENT_CACHE_HTML_BYTES = 2 * 1024 * 1024;

/** Return the content cache directory, creating it on first use */
async function getContentDir(): Promise<string> {
  if (_contentDir) return _contentDir;
  const dataDir = await appDataDir();
  const dir = `${dataDir}/content`;
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Already exists -- mkdir throws if the directory is present
  }
  _contentDir = dir;
  return dir;
}

/** Sanitize a globalId so it's safe to use as a filename */
function idToFilename(globalId: string): string {
  return globalId.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") + ".html";
}

function htmlByteLength(html: string): number {
  return new TextEncoder().encode(html).byteLength;
}

async function contentPathForId(globalId: string): Promise<string> {
  const dir = await getContentDir();
  return `${dir}/${idToFilename(globalId)}`;
}

export const contentCache = {
  /**
   * Retrieve cached HTML for a globalId.
   * Returns null when no cached file exists.
   */
  async get(globalId: string): Promise<string | null> {
    try {
      const path = await contentPathForId(globalId);
      const bytes = await size(path);
      if (bytes > MAX_CONTENT_CACHE_HTML_BYTES) {
        await remove(path).catch(() => {});
        console.warn(
          `[content-cache] skipped oversized cached HTML id=${globalId} size_bytes=${bytes.toLocaleString()} limit_bytes=${MAX_CONTENT_CACHE_HTML_BYTES.toLocaleString()}`,
        );
        return null;
      }
      return await readTextFile(path);
    } catch {
      return null;
    }
  },

  /**
   * Write HTML to the content cache for a globalId.
   * Creates or overwrites the file.
   */
  async set(globalId: string, html: string): Promise<void> {
    const path = await contentPathForId(globalId);
    const bytes = htmlByteLength(html);
    if (bytes > MAX_CONTENT_CACHE_HTML_BYTES) {
      await remove(path).catch(() => {});
      console.warn(
        `[content-cache] skipped oversized HTML write id=${globalId} size_bytes=${bytes.toLocaleString()} limit_bytes=${MAX_CONTENT_CACHE_HTML_BYTES.toLocaleString()}`,
      );
      return;
    }
    await writeTextFile(path, html);
  },

  /**
   * Check whether HTML is cached for a globalId without reading the content.
   */
  async has(globalId: string): Promise<boolean> {
    try {
      return await exists(await contentPathForId(globalId));
    } catch {
      return false;
    }
  },

  /**
   * Delete the cached HTML for a globalId.
   * No-op when the file does not exist.
   */
  async delete(globalId: string): Promise<void> {
    try {
      await remove(await contentPathForId(globalId));
    } catch {
      // Already gone
    }
  },

  /**
   * List all globalIds that have cached HTML on this device.
   * Strips the ".html" suffix from each filename.
   */
  async list(): Promise<string[]> {
    try {
      const dir = await getContentDir();
      const entries = await readDir(dir);
      return entries
        .filter((e) => e.name?.endsWith(".html"))
        .map((e) => e.name!.slice(0, -5)); // strip ".html"
    } catch {
      return [];
    }
  },

  /**
   * Delete legacy cache files that are too large to safely hand to the renderer.
   */
  async pruneOversized(): Promise<number> {
    try {
      const dir = await getContentDir();
      const entries = await readDir(dir);
      let removed = 0;
      for (const entry of entries) {
        if (!entry.name?.endsWith(".html")) continue;
        const path = `${dir}/${entry.name}`;
        try {
          const bytes = await size(path);
          if (bytes <= MAX_CONTENT_CACHE_HTML_BYTES) continue;
          await remove(path);
          removed += 1;
          console.warn(
            `[content-cache] pruned oversized cached HTML file=${entry.name} size_bytes=${bytes.toLocaleString()} limit_bytes=${MAX_CONTENT_CACHE_HTML_BYTES.toLocaleString()}`,
          );
        } catch {
          // Ignore individual files that disappear or cannot be inspected.
        }
      }
      return removed;
    } catch {
      return 0;
    }
  },
};
