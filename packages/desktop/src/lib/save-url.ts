/**
 * Desktop URL save flow
 *
 * Architecture:
 *  1. Validate and normalize the URL.
 *  2. Write a lightweight saved stub through the typed SQLite mutation API.
 *  3. Queue background detail fetching and cache hydration.
 */

import { invoke } from "@tauri-apps/api/core";
import { extractMetadataBrowser } from "@freed/capture-save/browser";
import {
  withSavedItemNote,
  type FeedItem,
} from "@freed/shared";
import {
  addLibraryStubItem,
  removeLibraryFeedItem,
  updateLibraryFeedItem,
} from "./library-client";
import { enqueue } from "./content-fetcher.js";

export interface SaveUrlOptions {
  notes?: string;
  preview?: {
    description?: string;
    suggestedNote: string;
    title: string;
    url: string;
  };
  tags?: string[];
}

export interface SaveUrlResult {
  globalId: string;
}

const SAVE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

function stableHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }
  return parsed.toString();
}

export async function previewSaveUrlInDesktop(
  url: string,
  signal?: AbortSignal,
): Promise<{
  description?: string;
  suggestedNote: string;
  title: string;
  url: string;
}> {
  const stableUrl = stableHttpUrl(url);
  signal?.throwIfAborted();
  const html = await invoke<string>("fetch_url", {
    url: stableUrl,
    maxBytes: SAVE_PREVIEW_MAX_BYTES,
  });
  signal?.throwIfAborted();
  const metadata = extractMetadataBrowser(html, stableUrl);
  return {
    url: stableUrl,
    title: metadata.title,
    ...(metadata.description ? { description: metadata.description } : {}),
    suggestedNote: metadata.description ?? "",
  };
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
  const stableUrl = stableHttpUrl(url);
  const preview = options.preview?.url === stableUrl ? options.preview : undefined;
  const item = await addLibraryStubItem(stableUrl, options.tags);
  const content = preview
    ? {
        ...item.content,
        text: preview.description ?? item.content.text,
        linkPreview: {
          url: stableUrl,
          title: preview.title,
          ...(preview.description ? { description: preview.description } : {}),
        },
      }
    : item.content;
  const userState = options.notes
    ? {
        ...item.userState,
        highlights: withSavedItemNote([], options.notes),
      }
    : item.userState;
  const savedItem = { ...item, content, userState };
  if (preview || options.notes) {
    await updateLibraryFeedItem(item.globalId, {
      ...(preview ? { content } : {}),
      ...(options.notes ? { userState } : {}),
    });
  }
  enqueue([savedItem], {
    priority: true,
    force: true,
    bypassStartupDelay: true,
    reopenSaveDialogOnError: true,
  });
  return { globalId: savedItem.globalId };
}

export async function updateSavedContentInDesktop(
  item: FeedItem,
  input: {
    notes: string;
    preview?: SaveUrlOptions["preview"];
    url: string;
  },
): Promise<SaveUrlResult> {
  const stableUrl = stableHttpUrl(input.url);
  const currentUrl = item.sourceUrl ?? item.content.linkPreview?.url ?? "";
  if (stableUrl === currentUrl) {
    await updateLibraryFeedItem(item.globalId, {
      userState: {
        ...item.userState,
        highlights: withSavedItemNote(item.userState.highlights, input.notes),
      },
    });
    return { globalId: item.globalId };
  }

  const saved = await saveUrlInDesktop(stableUrl, {
    notes: input.notes,
    preview: input.preview,
    tags: item.userState.tags,
  });
  await removeLibraryFeedItem(item.globalId);
  return saved;
}
