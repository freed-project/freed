import {
  buildSavedFeedItem,
} from "@freed/capture-save/normalize";
import { extractMetadataBrowser } from "@freed/capture-save/browser";
import { withSavedItemNote, type FeedItem } from "@freed/shared";
import {
  enqueuePwaLibraryCoreFeedItemCapture,
  enqueuePwaLibraryCoreFeedItemAnnotationSets,
  enqueuePwaLibraryCoreFeedItemRemove,
} from "./library-core-runtime";

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

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > SAVE_PREVIEW_MAX_BYTES) {
    throw new Error("URL preview response is too large");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > SAVE_PREVIEW_MAX_BYTES) {
      throw new Error("URL preview response is too large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > SAVE_PREVIEW_MAX_BYTES) {
      await reader.cancel();
      throw new Error("URL preview response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function previewSaveUrlInPwa(
  url: string,
  signal?: AbortSignal,
): Promise<{
  description?: string;
  suggestedNote: string;
  title: string;
  url: string;
}> {
  const stableUrl = stableHttpUrl(url);
  const response = await fetch(stableUrl, {
    signal,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`URL preview failed (${response.status.toLocaleString()})`);
  const html = await readBoundedResponseText(response);
  const metadata = extractMetadataBrowser(html, stableUrl);
  return {
    url: stableUrl,
    title: metadata.title,
    ...(metadata.description ? { description: metadata.description } : {}),
    suggestedNote: metadata.description ?? "",
  };
}

export async function saveUrlInPwa(
  url: string,
  options: SaveUrlOptions = {},
): Promise<SaveUrlResult> {
  const stableUrl = stableHttpUrl(url);
  const preview = options.preview?.url === stableUrl ? options.preview : undefined;
  const item = buildSavedFeedItem(
    {
      title: preview?.title ?? stableUrl,
      url: stableUrl,
      ...(preview?.description ? { description: preview.description } : {}),
    },
    null,
    {
      includeSourceUrl: true,
      tags: options.tags,
    },
  );
  const canonicalItem = JSON.parse(JSON.stringify(item)) as typeof item;
  await enqueuePwaLibraryCoreFeedItemCapture(canonicalItem);
  if ((options.tags?.length ?? 0) > 0 || (options.notes?.length ?? 0) > 0) {
    await enqueuePwaLibraryCoreFeedItemAnnotationSets([
      {
        entityId: item.globalId,
        highlights: withSavedItemNote([], options.notes ?? ""),
        tags: options.tags ?? [],
      },
    ]);
  }
  return { globalId: item.globalId };
}

export async function updateSavedContentInPwa(
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
    await enqueuePwaLibraryCoreFeedItemAnnotationSets([
      {
        entityId: item.globalId,
        highlights: withSavedItemNote(item.userState.highlights, input.notes),
        tags: item.userState.tags,
      },
    ]);
    return { globalId: item.globalId };
  }

  const saved = await saveUrlInPwa(stableUrl, {
    notes: input.notes,
    preview: input.preview,
    tags: item.userState.tags,
  });
  await enqueuePwaLibraryCoreFeedItemRemove(item.globalId);
  return saved;
}
