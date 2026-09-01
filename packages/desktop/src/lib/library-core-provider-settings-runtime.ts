import { parseYouTubeVideoUrl, type FeedItem } from "@freed/shared";
import type {
  LibraryCoreProviderMediaPageRequestV1,
  LibraryCoreProviderMediaPageResponseV1,
  LibraryCoreProviderMediaRowV1,
} from "@freed/shared/library-core";

import {
  createDesktopLibraryCoreOperationId,
  queryNormalizedLibrary,
} from "./library-core-normalized-query-client";

const LIBRARY_CORE_PROVIDER_SETTINGS_PAGE_LIMIT = 64;

type LibraryCoreProviderSettingsSource = "facebook" | "instagram" | "youtube";
type QueryLibraryCoreProviderMediaPage = (
  request: LibraryCoreProviderMediaPageRequestV1,
) => Promise<LibraryCoreProviderMediaPageResponseV1>;

interface LibraryCoreProviderSettingsScanOptions {
  readonly queryPage?: QueryLibraryCoreProviderMediaPage;
  readonly signal?: AbortSignal;
}

function providerMediaRowToFeedItem(
  row: LibraryCoreProviderMediaRowV1,
): FeedItem {
  return {
    globalId: row.globalId,
    platform: row.platform as FeedItem["platform"],
    contentType: (row.contentType ?? "post") as FeedItem["contentType"],
    capturedAt: row.capturedAt ?? 0,
    publishedAt: row.publishedAt ?? row.capturedAt ?? 0,
    author: {
      id: row.authorId ?? "",
      handle: row.authorHandle ?? "",
      displayName: row.authorDisplayName ?? "",
      ...(row.authorAvatarUrl === null
        ? {}
        : { avatarUrl: row.authorAvatarUrl }),
    },
    content: {
      mediaUrls: [...row.mediaUrls],
      mediaTypes: [...row.mediaTypes] as FeedItem["content"]["mediaTypes"],
      ...(row.linkUrl === null
        ? {}
        : {
            linkPreview: {
              url: row.linkUrl,
              title: row.linkPreviewTitle ?? "",
            },
          }),
    },
    userState: {
      saved: row.saved === true,
      hidden: false,
      archived: row.archived === true,
      tags: [...row.tags],
    },
    topics: [],
    ...(row.sourceUrl === null ? {} : { sourceUrl: row.sourceUrl }),
    ...(row.fbGroup === null ? {} : { fbGroup: row.fbGroup }),
  };
}

async function scanBoundedLibraryCoreProviderSettingsPages(
  source: LibraryCoreProviderSettingsSource,
  savedOnly: boolean,
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  options: LibraryCoreProviderSettingsScanOptions,
): Promise<void> {
  const queryPage = options.queryPage ?? queryNormalizedLibrary;
  const readerSessionId = createDesktopLibraryCoreOperationId(
    "provider-media-reader",
  );
  const cancellationId = createDesktopLibraryCoreOperationId(
    "provider-media-cancel",
  );
  let cursor: string | null = null;
  for (;;) {
    if (options.signal?.aborted) {
      throw new Error("Library Core provider settings scan was cancelled");
    }
    const page = await queryPage({
      cancellationId,
      cursor,
      limit: LIBRARY_CORE_PROVIDER_SETTINGS_PAGE_LIMIT,
      provider: source,
      queryId: "provider_media_page_v1",
      readerSessionId,
      savedOnly,
      schemaVersion: 1,
    });
    if (page.rows.length > LIBRARY_CORE_PROVIDER_SETTINGS_PAGE_LIMIT) {
      throw new Error("Library Core provider settings page exceeds 64 rows");
    }
    await visitPage(page.rows.map(providerMediaRowToFeedItem));
    if (options.signal?.aborted) {
      throw new Error("Library Core provider settings scan was cancelled");
    }
    cursor = page.nextCursor;
    if (cursor === null) return;
  }
}

/** Visit compact provider media rows through the typed SQLite query. */
export async function scanLibraryCoreProviderItems(
  source: LibraryCoreProviderSettingsSource,
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  options: LibraryCoreProviderSettingsScanOptions = {},
): Promise<void> {
  await scanBoundedLibraryCoreProviderSettingsPages(
    source,
    false,
    visitPage,
    options,
  );
}

/** Collect canonical identities from the saved YouTube projection only. */
export async function readSavedLibraryCoreYouTubeVideoUrls(
  options: LibraryCoreProviderSettingsScanOptions = {},
): Promise<string[]> {
  const videoIds = new Set<string>();
  const urls: string[] = [];
  await scanBoundedLibraryCoreProviderSettingsPages(
    "youtube",
    true,
    (page) => {
      for (const item of page) {
        const reference = [item.sourceUrl, item.content.linkPreview?.url]
          .map((url) => parseYouTubeVideoUrl(url))
          .find((candidate) => candidate !== null);
        if (!reference || videoIds.has(reference.videoId)) continue;
        videoIds.add(reference.videoId);
        urls.push(reference.canonicalWatchUrl);
      }
    },
    options,
  );
  return urls;
}
