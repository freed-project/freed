import { invoke } from "@tauri-apps/api/core";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedBrowseFilterV1,
  isLibraryCoreOperationInstanceId,
  libraryCoreFeedCardToItemV1,
  parseLibraryCoreFeedBrowsePageResponseV2,
  parseLibraryCoreFeedBrowsePageResponseV3,
  type LibraryCoreFeedBrowseDirectionV3,
  type LibraryCoreFeedBrowseFilterInputV1,
  type LibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseIdentityModeV2,
  type LibraryCoreFeedBrowsePageRequestV1,
  type LibraryCoreFeedBrowsePageRequestV2,
  type LibraryCoreFeedBrowsePageRequestV3,
  type LibraryCoreFeedBrowsePageResponseV2,
  type LibraryCoreFeedBrowsePageResponseV3,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";
import type { FeedItem } from "@freed/shared";
import { compileFriendAuthorIndex } from "@freed/shared";

import {
  getDocState,
  getLibraryCoreProjectionSource,
  materializeLibraryCoreFeedBrowseGeneration,
} from "./automerge";
import { isSqliteLibraryActive, querySqliteItems } from "./sqlite-library";
import type {
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";

export interface SelectedLibraryCoreFeedBrowseGenerationV1 {
  readonly binding: LibraryCoreFeedBrowseGenerationBindingV1;
  readonly byteLength: number;
  readonly fileDigest: string;
  readonly selectionSequence: number;
}

export interface LibraryCoreFeedBrowseReaderNativeClient {
  getSelection(): Promise<SelectedLibraryCoreFeedBrowseGenerationV1 | null>;
  select(input: {
    binding: LibraryCoreFeedBrowseGenerationBindingV1;
    transitionId: string;
    expectedCurrentGenerationId: string | null;
  }): Promise<SelectedLibraryCoreFeedBrowseGenerationV1>;
  read(
    request:
      | LibraryCoreFeedBrowsePageRequestV1
      | LibraryCoreFeedBrowsePageRequestV2
      | LibraryCoreFeedBrowsePageRequestV3,
  ): Promise<unknown>;
  cancel(readerSessionId: string, cancellationId: string): Promise<void>;
}

export const tauriLibraryCoreFeedBrowseReaderNativeClient: LibraryCoreFeedBrowseReaderNativeClient =
  {
    getSelection() {
      return invoke<SelectedLibraryCoreFeedBrowseGenerationV1 | null>(
        "get_library_core_feed_browse_selection",
      );
    },
    select(input) {
      return invoke<SelectedLibraryCoreFeedBrowseGenerationV1>(
        "select_library_core_feed_browse_generation",
        { input },
      );
    },
    read(request) {
      return invoke<unknown>("read_library_core_feed_browse_page", { request });
    },
    async cancel(readerSessionId, cancellationId) {
      await invoke("cancel_library_core_feed_browse_reader", {
        readerSessionId,
        cancellationId,
      });
    },
  };

function newOperationId(prefix: string): LibraryCoreOperationInstanceId {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Secure random UUID generation is unavailable");
  const value = `${prefix}:${uuid}`;
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new Error("Generated Library Core operation ID is invalid");
  }
  return value;
}

function sameProjectionSource(
  source: LibraryCoreProjectionSourceV1,
  binding: LibraryCoreFeedBrowseGenerationBindingV1,
): boolean {
  return (
    source.schemaVersion === 1 &&
    source.documentId === binding.sourceDocumentId &&
    source.headsDigest === binding.sourceHeadsDigest &&
    source.headCount === binding.sourceHeadCount &&
    source.storageRevision.generation === binding.transitionSequence &&
    source.storageRevision.saveRevision === binding.projectionRevision
  );
}

function assertSelectedGeneration(
  selected: SelectedLibraryCoreFeedBrowseGenerationV1,
  binding: LibraryCoreFeedBrowseGenerationBindingV1,
): void {
  if (
    selected.binding.generationId !== binding.generationId ||
    selected.binding.sourceDocumentId !== binding.sourceDocumentId ||
    selected.binding.sourceHeadsDigest !== binding.sourceHeadsDigest ||
    selected.binding.sourceHeadCount !== binding.sourceHeadCount ||
    selected.binding.transitionSequence !== binding.transitionSequence ||
    selected.binding.projectionRevision !== binding.projectionRevision ||
    selected.binding.filterJson !== binding.filterJson ||
    selected.binding.rankingClockMs !== binding.rankingClockMs ||
    selected.binding.recommendationOrderSchemaVersion !==
      binding.recommendationOrderSchemaVersion ||
    selected.binding.totalRows !== binding.totalRows ||
    !Number.isSafeInteger(selected.byteLength) ||
    selected.byteLength < 1 ||
    !/^[0-9a-f]{64}$/u.test(selected.fileDigest) ||
    !Number.isSafeInteger(selected.selectionSequence) ||
    selected.selectionSequence < 0
  ) {
    throw new Error("Library Core selected generation identity is invalid");
  }
}

export interface LibraryCoreFeedBrowseReaderSession {
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly identityMode: LibraryCoreFeedBrowseIdentityModeV2;
  readonly rankingClockMs: number;
  readonly totalCount: number;
  readNext(
    limit?: number,
  ): Promise<
    LibraryCoreFeedBrowsePageResponseV2 | LibraryCoreFeedBrowsePageResponseV3
  >;
  /**
   * Read one page in either direction from an opaque edge cursor.
   *
   * Only the all-content generation speaks the bidirectional V3 contract. The
   * Friends generation keeps its closed forward-only V2 wire shape.
   */
  readPage?(
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
    limit?: number,
  ): Promise<LibraryCoreFeedBrowsePageResponseV3>;
  close(): Promise<void>;
}

class DesktopLibraryCoreFeedBrowseReaderSession
  implements LibraryCoreFeedBrowseReaderSession
{
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly identityMode: LibraryCoreFeedBrowseIdentityModeV2;
  readonly rankingClockMs: number;
  readonly totalCount: number;
  private cursor: string | null = null;
  private exhausted = false;
  private closed = false;
  private cancellationId = newOperationId("browse-cancel");

  constructor(
    private readonly native: LibraryCoreFeedBrowseReaderNativeClient,
    private readonly readerSessionId: LibraryCoreOperationInstanceId,
    filter: LibraryCoreFeedBrowseFilterV1,
    identityMode: LibraryCoreFeedBrowseIdentityModeV2,
    rankingClockMs: number,
    totalCount: number,
  ) {
    this.filter = filter;
    this.identityMode = identityMode;
    this.rankingClockMs = rankingClockMs;
    this.totalCount = totalCount;
  }

  private requestBase(limit: number) {
    this.cancellationId = newOperationId("browse-cancel");
    return {
      cancellationId: this.cancellationId,
      filter: this.filter,
      limit,
      rankingClockMs: this.rankingClockMs,
      readerSessionId: this.readerSessionId,
      recommendationOrderSchemaVersion:
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    };
  }

  readPage = async (
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
    limit = LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  ): Promise<LibraryCoreFeedBrowsePageResponseV3> => {
    if (this.closed) throw new Error("Library Core browse reader is closed");
    if (this.identityMode !== "all_content") {
      throw new Error("Library Core browse reader is not bidirectional");
    }
    const request: LibraryCoreFeedBrowsePageRequestV3 = {
      ...this.requestBase(limit),
      cursor,
      direction,
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
    };
    const raw = await this.native.read(request);
    const parsed = parseLibraryCoreFeedBrowsePageResponseV3(raw, request);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  };

  async readNext(
    limit = LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  ): Promise<
    LibraryCoreFeedBrowsePageResponseV2 | LibraryCoreFeedBrowsePageResponseV3
  > {
    if (this.closed) throw new Error("Library Core browse reader is closed");
    if (this.exhausted) throw new Error("Library Core browse reader is exhausted");
    if (this.identityMode === "all_content") {
      const page = await this.readPage(this.cursor, "next", limit);
      this.cursor = page.nextCursor;
      this.exhausted = this.cursor === null;
      return page;
    }
    const request: LibraryCoreFeedBrowsePageRequestV2 = {
      ...this.requestBase(limit),
      cursor: this.cursor,
      friendsPredicateSchemaVersion:
        LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
      identityMode: "friends",
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_SCHEMA_VERSION,
    };
    const raw = await this.native.read(request);
    const parsed = parseLibraryCoreFeedBrowsePageResponseV2(raw, request);
    if (!parsed.ok) throw new Error(parsed.error);
    this.cursor = parsed.value.nextCursor;
    this.exhausted = this.cursor === null;
    return parsed.value;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.native.cancel(this.readerSessionId, this.cancellationId);
  }
}

export async function openLibraryCoreFeedBrowseReader(
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
  native: LibraryCoreFeedBrowseReaderNativeClient =
    tauriLibraryCoreFeedBrowseReaderNativeClient,
  identityMode: LibraryCoreFeedBrowseIdentityModeV2 = "all_content",
): Promise<LibraryCoreFeedBrowseReaderSession> {
  const materialized = await materializeLibraryCoreFeedBrowseGeneration(
    filterInput,
    rankingClockMs,
    identityMode,
  );
  const source = await getLibraryCoreProjectionSource();
  if (!sameProjectionSource(source, materialized.binding)) {
    throw new Error("Library Core browse projection source changed before selection");
  }
  const current = await native.getSelection();
  const selected = await native.select({
    binding: materialized.binding,
    transitionId: newOperationId("browse-select"),
    expectedCurrentGenerationId: current?.binding.generationId ?? null,
  });
  assertSelectedGeneration(selected, materialized.binding);
  const confirmedSource = await getLibraryCoreProjectionSource();
  if (!sameProjectionSource(confirmedSource, materialized.binding)) {
    throw new Error("Library Core browse projection source changed after selection");
  }
  return new DesktopLibraryCoreFeedBrowseReaderSession(
    native,
    newOperationId("browse-reader"),
    materialized.filter,
    identityMode,
    rankingClockMs,
    materialized.binding.totalRows,
  );
}

export const LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY =
  "freed.libraryCore.feedBrowseReaderV1.disabled";
export const LIBRARY_CORE_FRIENDS_FEED_READER_DISABLED_KEY =
  "freed.libraryCore.friendsFeedReaderV1.disabled";
/**
 * Roll back the bidirectional all-content reader on one device.
 *
 * Setting this returns the ordinary feed to the Automerge compatibility
 * projection rather than to a forward-only bounded reader: without reverse
 * paging, evicting a leading page would lose rows the user can scroll back to.
 */
export const LIBRARY_CORE_FEED_BROWSE_BIDIRECTIONAL_READER_DISABLED_KEY =
  "freed.libraryCore.feedBrowseBidirectionalReaderV1.disabled";

export interface BoundedDesktopFeedPage {
  readonly items: readonly FeedItem[];
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
}

async function openSqliteFeedReader(
  filterInput: LibraryCoreFeedBrowseFilterInputV1,
  include: (item: FeedItem) => boolean = () => true,
): Promise<{
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  readPage(
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<BoundedDesktopFeedPage>;
  close(): Promise<void>;
}> {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(filterInput),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const filter = parsed.value;
  const readFiltered = async (startOffset: number) => {
    const items: FeedItem[] = [];
    let offset: number | null = startOffset;
    let totalCount = 0;
    while (offset !== null && items.length < LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT) {
      const page = await querySqliteItems({
        platform: filter.platform ?? undefined,
        authorId: filter.authorId ?? undefined,
        feedUrl: filter.feedUrl ?? undefined,
        saved: filter.savedOnly ? true : undefined,
        archived: filter.archivedOnly ? true : false,
        showHidden: filter.showHidden,
        offset,
        limit: 128,
      });
      totalCount = page.totalCount;
      items.push(
        ...page.items.filter(
          (item) => matchesLibraryCoreFeedBrowseFilterV1(item, filter) && include(item),
        ),
      );
      offset = page.nextOffset;
    }
    return {
      items: items.slice(0, LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT),
      nextOffset: offset,
      totalCount,
    };
  };

  const initial = await readFiltered(0);
  let nextOffset: number | null = 0;
  return {
    totalCount: initial.totalCount,
    async readNext() {
      if (nextOffset === null) return [];
      const page = nextOffset === 0 ? initial : await readFiltered(nextOffset);
      nextOffset = page.nextOffset;
      return page.items;
    },
    async readPage(cursor, direction) {
      const requested = cursor?.startsWith("sqlite:")
        ? Number.parseInt(cursor.slice("sqlite:".length), 10)
        : 0;
      const safeOffset = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
      const start = direction === "previous" ? Math.max(0, safeOffset - 128) : safeOffset;
      const page = start === 0 ? initial : await readFiltered(start);
      return {
        items: page.items,
        nextCursor: page.nextOffset === null ? null : `sqlite:${page.nextOffset}`,
        previousCursor: start === 0 ? null : `sqlite:${start}`,
      };
    },
    async close() {},
  };
}

export async function openBoundedDesktopFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<{
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  readPage(
    cursor: string | null,
    direction: LibraryCoreFeedBrowseDirectionV3,
  ): Promise<BoundedDesktopFeedPage>;
  close(): Promise<void>;
}> {
  if (isSqliteLibraryActive()) return openSqliteFeedReader(filter);
  if (
    typeof localStorage !== "undefined" &&
    (localStorage.getItem(LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY) ===
      "1" ||
      localStorage.getItem(
        LIBRARY_CORE_FEED_BROWSE_BIDIRECTIONAL_READER_DISABLED_KEY,
      ) === "1")
  ) {
    throw new Error("Library Core bounded feed reader is disabled");
  }
  const session = await openLibraryCoreFeedBrowseReader(filter, rankingClockMs);
  const readPage = session.readPage;
  if (!readPage) {
    throw new Error("Library Core bounded feed reader is not bidirectional");
  }
  return {
    totalCount: session.totalCount,
    async readNext() {
      const page = await session.readNext();
      return page.rows.map(libraryCoreFeedCardToItemV1);
    },
    async readPage(cursor, direction) {
      const page = await readPage(cursor, direction);
      return {
        items: page.rows.map(libraryCoreFeedCardToItemV1),
        nextCursor: page.nextCursor,
        previousCursor: page.previousCursor,
      };
    },
    close() {
      return session.close();
    },
  };
}

export async function openBoundedDesktopFriendsFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<{
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  close(): Promise<void>;
}> {
  if (isSqliteLibraryActive()) {
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
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_FRIENDS_FEED_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core bounded Friends feed reader is disabled");
  }
  const session = await openLibraryCoreFeedBrowseReader(
    filter,
    rankingClockMs,
    tauriLibraryCoreFeedBrowseReaderNativeClient,
    "friends",
  );
  return {
    totalCount: session.totalCount,
    async readNext() {
      const page = await session.readNext();
      return page.rows.map(libraryCoreFeedCardToItemV1);
    },
    close() {
      return session.close();
    },
  };
}
