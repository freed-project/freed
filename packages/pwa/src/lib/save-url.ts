import { hashSavedUrl } from "@freed/capture-save/normalize";
import { docAddStubItem } from "./automerge";

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
  await docAddStubItem(stableUrl, options.tags);
  return { globalId: `saved:${hashSavedUrl(stableUrl)}` };
}
