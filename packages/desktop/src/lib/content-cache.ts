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
} from "@tauri-apps/plugin-fs";

// Cached base directory path to avoid repeated IPC calls
let _contentDir: string | null = null;

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

export const contentCache = {
  /**
   * Retrieve cached HTML for a globalId.
   * Returns null when no cached file exists.
   */
  async get(globalId: string): Promise<string | null> {
    try {
      const dir = await getContentDir();
      return await readTextFile(`${dir}/${idToFilename(globalId)}`);
    } catch {
      return null;
    }
  },

  /**
   * Write HTML to the content cache for a globalId.
   * Creates or overwrites the file.
   */
  async set(globalId: string, html: string): Promise<void> {
    const dir = await getContentDir();
    await writeTextFile(`${dir}/${idToFilename(globalId)}`, html);
  },

  /**
   * Check whether HTML is cached for a globalId without reading the content.
   */
  async has(globalId: string): Promise<boolean> {
    try {
      const dir = await getContentDir();
      return await exists(`${dir}/${idToFilename(globalId)}`);
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
      const dir = await getContentDir();
      await remove(`${dir}/${idToFilename(globalId)}`);
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
};
