import { hashSavedUrl } from "@freed/capture-save/normalize";
import { docAddStubItem } from "./legacy-automerge-runtime";
import { isPwaLibraryCoreEnabled } from "./library-core-runtime";

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
  if (isPwaLibraryCoreEnabled()) {
    throw new Error(
      "Saving new links is unavailable until the SQLite Library intent is active",
    );
  }
  await docAddStubItem(stableUrl, options.tags);
  return { globalId: `saved:${hashSavedUrl(stableUrl)}` };
}
