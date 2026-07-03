/**
 * Desktop URL save flow
 *
 * Architecture:
 *  1. Validate and normalize the URL.
 *  2. Write a lightweight saved stub to Automerge.
 *  3. Queue background detail fetching and cache hydration.
 */

import { docAddStubItem } from "./automerge.js";
import { enqueue } from "./content-fetcher.js";

export interface SaveUrlOptions {
  tags?: string[];
}

export interface SaveUrlResult {
  globalId: string;
}

/**
 * Save a URL to the Freed desktop library.
 *
 * The user-visible save path only writes a stub. Detail fetching runs through
 * the background content fetcher so the modal can close immediately.
 */
export async function saveUrlInDesktop(
  url: string,
  options: SaveUrlOptions = {},
): Promise<SaveUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  const stableUrl = parsed.toString();
  const item = await docAddStubItem(stableUrl, options.tags);
  enqueue([item], {
    priority: true,
    force: true,
    bypassStartupDelay: true,
    reopenSaveDialogOnError: true,
  });
  return { globalId: item.globalId };
}
