import {
  buildSavedFeedItem,
} from "@freed/capture-save/normalize";
import {
  enqueuePwaLibraryCoreFeedItemCapture,
} from "./library-core-runtime";

export interface SaveUrlOptions {
  tags?: string[];
}

export interface SaveUrlResult {
  globalId: string;
}

export async function saveUrlInPwa(
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
  const item = buildSavedFeedItem(
    { title: stableUrl, url: stableUrl },
    null,
    {
      includeSourceUrl: true,
      tags: options.tags,
    },
  );
  const canonicalItem = JSON.parse(JSON.stringify(item)) as typeof item;
  await enqueuePwaLibraryCoreFeedItemCapture(canonicalItem);
  return { globalId: item.globalId };
}
