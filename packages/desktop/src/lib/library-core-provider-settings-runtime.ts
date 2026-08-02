import { parseYouTubeVideoUrl, type FeedItem } from "@freed/shared";

import { scanLibraryCoreItems } from "./library-core-item-detail-runtime";

const LIBRARY_CORE_PROVIDER_SETTINGS_PAGE_LIMIT = 64;

const LIBRARY_CORE_PROVIDER_SETTINGS_READER_DISABLED_KEY =
  "freed.libraryCore.providerSettingsReaderV1.disabled";

type LibraryCoreProviderSettingsSource = "facebook" | "instagram" | "youtube";

type ScanLibraryCoreProviderSettingsItems = (
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
) => Promise<void>;

interface LibraryCoreProviderSettingsScanOptions {
  readonly scanItems?: ScanLibraryCoreProviderSettingsItems;
  readonly signal?: AbortSignal;
}

export function isLibraryCoreProviderSettingsReaderDisabled(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): boolean {
  return (
    storage?.getItem(LIBRARY_CORE_PROVIDER_SETTINGS_READER_DISABLED_KEY) === "1"
  );
}

function assertLibraryCoreProviderSettingsReaderEnabled(): void {
  if (isLibraryCoreProviderSettingsReaderDisabled()) {
    throw new Error("Library Core provider settings reader is disabled");
  }
}

async function scanBoundedLibraryCoreProviderSettingsPages(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  options: LibraryCoreProviderSettingsScanOptions,
): Promise<void> {
  const scanItems = options.scanItems ?? scanLibraryCoreItems;
  const assertActive = (): void => {
    if (options.signal?.aborted) {
      throw new Error("Library Core provider settings scan was cancelled");
    }
  };
  assertLibraryCoreProviderSettingsReaderEnabled();
  assertActive();
  await scanItems(async (page) => {
    assertLibraryCoreProviderSettingsReaderEnabled();
    assertActive();
    if (page.length > LIBRARY_CORE_PROVIDER_SETTINGS_PAGE_LIMIT) {
      throw new Error("Library Core provider settings page exceeds 64 rows");
    }
    await visitPage(page);
    assertActive();
  });
  assertActive();
}

/**
 * Visit one provider's renderer-visible items without retaining the full
 * Library corpus.
 *
 * `scanLibraryCoreItems` owns the durable source fence. This wrapper preserves
 * its sequential bounded-page contract and removes unrelated providers before
 * any provider-settings consumer receives a page.
 */
export async function scanLibraryCoreProviderItems(
  source: LibraryCoreProviderSettingsSource,
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  options: LibraryCoreProviderSettingsScanOptions = {},
): Promise<void> {
  await scanBoundedLibraryCoreProviderSettingsPages(
    (page) =>
      visitPage(
        page.filter(
          (item) => item.platform === source && !item.userState.hidden,
        ),
      ),
    options,
  );
}

/**
 * Collect compact canonical URLs for every distinct visible saved YouTube
 * identity. The native scanner provides stable global-ID order so repeated
 * user-triggered batches are deterministic without retaining FeedItem rows.
 */
export async function readSavedLibraryCoreYouTubeVideoUrls(
  options: LibraryCoreProviderSettingsScanOptions = {},
): Promise<string[]> {
  const videoIds = new Set<string>();
  const urls: string[] = [];

  await scanBoundedLibraryCoreProviderSettingsPages((page) => {
    for (const item of page) {
      if (!item.userState.saved || item.userState.hidden) continue;
      const reference = [item.sourceUrl, item.content.linkPreview?.url]
        .map((url) => parseYouTubeVideoUrl(url))
        .find((candidate) => candidate !== null);
      if (!reference || videoIds.has(reference.videoId)) continue;
      videoIds.add(reference.videoId);
      urls.push(reference.canonicalWatchUrl);
    }
  }, options);

  return urls;
}
