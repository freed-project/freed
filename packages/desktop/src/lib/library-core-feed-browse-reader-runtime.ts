/** Bounded SQLite readers for the Freed Desktop Library. */

import {
  compileFriendAuthorIndex,
  type FeedItem,
  type SavedContentSortMode,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  matchesLibraryCoreFeedBrowseFilterV1,
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
  include: (item: FeedItem) => boolean = () => true,
  sortMode?: SavedContentSortMode,
): Promise<BoundedDesktopFeedReader> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const filter = parsed.value;
  let nextOffset: number | null = 0;
  let closed = false;

  const accepts = (item: FeedItem): boolean =>
    matchesLibraryCoreFeedBrowseFilterV1(item, filter) && include(item);

  const readFiltered = async (startOffset: number) => {
    const items: FeedItem[] = [];
    let offset: number | null = startOffset;
    while (offset !== null && items.length < LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT) {
      const page = await querySqliteItems({
        platform: filter.platform ?? undefined,
        authorId: filter.authorId ?? undefined,
        feedUrl: filter.feedUrl ?? undefined,
        saved: filter.savedOnly ? true : undefined,
        archived: filter.archivedOnly ? true : false,
        showHidden: filter.showHidden,
        sortMode,
        offset,
        limit: 128,
      });
      let consumed = 0;
      for (const item of page.items) {
        consumed += 1;
        if (accepts(item)) items.push(item);
        if (items.length === LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT) break;
      }
      const rawNext: number = offset + consumed;
      offset = rawNext < page.totalCount ? rawNext : null;
    }
    return { items, nextOffset: offset };
  };

  let filteredTotalCount = 0;
  let countOffset: number | null = 0;
  while (countOffset !== null) {
    const page = await querySqliteItems({
      platform: filter.platform ?? undefined,
      authorId: filter.authorId ?? undefined,
      feedUrl: filter.feedUrl ?? undefined,
      saved: filter.savedOnly ? true : undefined,
      archived: filter.archivedOnly ? true : false,
      showHidden: filter.showHidden,
      sortMode,
      offset: countOffset,
      limit: 128,
    });
    filteredTotalCount += page.items.filter(accepts).length;
    countOffset = page.nextOffset;
  }
  const initial = await readFiltered(0);
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
  return openSqliteFeedReader(filter, () => true, sortMode);
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
  const reader = await openSqliteFeedReader(
    filter,
    (item) => friends.has(item.platform, item.author.id),
  );
  return {
    totalCount: reader.totalCount,
    readNext: reader.readNext,
    close: reader.close,
  };
}
