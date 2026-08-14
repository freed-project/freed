/** Bounded SQLite readers for the Freed Desktop Library. */

import {
  compileFriendAuthorIndex,
  FEED_SIGNAL_FILTER_PRESETS,
  type FeedItem,
  type FeedSignalMode,
  type SavedContentSortMode,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseDirectionV3,
  type LibraryCoreFeedBrowseFilterInputV1,
} from "@freed/shared/library-core";
import { getDocState } from "./library-client";
import { querySqliteItems } from "./sqlite-library";

export interface BoundedDesktopFeedPage {
  readonly items: readonly FeedItem[];
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
}

export interface BoundedDesktopFeedReader {
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  readPage(
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<BoundedDesktopFeedPage>;
  close(): Promise<void>;
}

const encodeCursor = (offset: number | null): string | null =>
  offset === null ? null : `sqlite:${offset.toLocaleString("en-US", { useGrouping: false })}`;

function decodeCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  if (!cursor.startsWith("sqlite:")) {
    throw new Error("SQLite Library cursor is invalid");
  }
  const offset = Number.parseInt(cursor.slice("sqlite:".length), 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("SQLite Library cursor is invalid");
  }
  return offset;
}

async function openSqliteFeedReader(
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
  authorKeys?: readonly Readonly<{ platform: string; authorId: string }>[],
  sortMode?: SavedContentSortMode,
): Promise<BoundedDesktopFeedReader> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const filter = parsed.value;
  let nextOffset: number | null = 0;
  let closed = false;

  const queryPage = (offset: number, includeTotalCount: boolean) => querySqliteItems({
    platform: filter.platform ?? undefined,
    authorId: filter.authorId ?? undefined,
    feedUrl: filter.feedUrl ?? undefined,
    contentType:
      filter.socialContentFilter === "stories" ? "story" : undefined,
    excludeContentType:
      filter.socialContentFilter === "posts" ? "story" : undefined,
    tags: filter.tags,
    signals: filter.signals,
    authorKeys,
    saved: filter.savedOnly ? true : undefined,
    archived: filter.archivedOnly ? true : false,
    showHidden: filter.showHidden,
    sortMode,
    offset,
    limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
    includeTotalCount,
  });

  const readFiltered = async (startOffset: number) => {
    const page = await queryPage(startOffset, false);
    return { items: page.items, nextOffset: page.nextOffset };
  };

  const exactInitialPage = await queryPage(0, true);
  const initial = {
    items: exactInitialPage.items,
    nextOffset: exactInitialPage.nextOffset,
  };
  const filteredTotalCount = exactInitialPage.totalCount;
  return {
    totalCount: filteredTotalCount,
    async readNext() {
      if (closed) throw new Error("SQLite Library reader is closed");
      if (nextOffset === null) return [];
      const page = nextOffset === 0 ? initial : await readFiltered(nextOffset);
      nextOffset = page.nextOffset;
      return page.items;
    },
    async readPage(cursor, direction) {
      if (closed) throw new Error("SQLite Library reader is closed");
      const offset = decodeCursor(cursor);
      const start =
        direction === "previous"
          ? Math.max(0, offset - LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT)
          : offset;
      const page = start === 0 ? initial : await readFiltered(start);
      return {
        items: page.items,
        nextCursor: encodeCursor(page.nextOffset),
        previousCursor:
          start === 0
            ? null
            : encodeCursor(
                Math.max(0, start - LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT),
              ),
      };
    },
    async close() {
      closed = true;
    },
  };
}

export async function openBoundedDesktopFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  _rankingClockMs: number,
): Promise<BoundedDesktopFeedReader> {
  return openSqliteFeedReader(filter);
}

export async function openSortedSqliteFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  sortMode: SavedContentSortMode,
): Promise<BoundedDesktopFeedReader> {
  return openSqliteFeedReader(filter, undefined, sortMode);
}

export async function openBoundedDesktopFriendsFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  _rankingClockMs: number,
): Promise<
  Pick<BoundedDesktopFeedReader, "totalCount" | "readNext" | "close">
> {
  const state = getDocState();
  const friends = compileFriendAuthorIndex(
    state?.persons ?? {},
    state?.accounts ?? {},
    state?.friends ?? {},
  );
  const reader = await openSqliteFeedReader(filter, friends.entries());
  return {
    totalCount: reader.totalCount,
    readNext: reader.readNext,
    close: reader.close,
  };
}

export async function readDesktopFeedSignalCounts(
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
): Promise<Readonly<Record<FeedSignalMode, number>>> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const filter = parsed.value;
  const entries = await Promise.all(FEED_SIGNAL_FILTER_PRESETS.map(async (preset) => {
    const page = await querySqliteItems({
      platform: filter.platform ?? undefined,
      authorId: filter.authorId ?? undefined,
      feedUrl: filter.feedUrl ?? undefined,
      contentType: filter.socialContentFilter === "stories" ? "story" : undefined,
      excludeContentType: filter.socialContentFilter === "posts" ? "story" : undefined,
      tags: filter.tags,
      signals: preset.mode === "all" ? undefined : preset.signals,
      saved: filter.savedOnly ? true : undefined,
      archived: filter.archivedOnly ? true : false,
      showHidden: filter.showHidden,
      limit: 1,
      includeTotalCount: true,
    });
    return [preset.mode, page.totalCount] as const;
  }));
  return Object.fromEntries(entries) as Readonly<Record<FeedSignalMode, number>>;
}
