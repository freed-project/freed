import { invoke } from "@tauri-apps/api/core";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  isLibraryCoreOperationInstanceId,
  parseLibraryCoreFeedBrowsePageResponseV1,
  parseLibraryCoreFeedBrowsePageResponseV2,
  type LibraryCoreFeedBrowseFilterInputV1,
  type LibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseIdentityModeV2,
  type LibraryCoreFeedBrowsePageRequestV1,
  type LibraryCoreFeedBrowsePageRequestV2,
  type LibraryCoreFeedBrowsePageResponseV1,
  type LibraryCoreFeedBrowsePageResponseV2,
  type LibraryCoreFeedCardV1,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";
import type {
  ContentType,
  ContentSignal,
  FeedItem,
  MediaType,
  Platform,
} from "@freed/shared";

import {
  getLibraryCoreProjectionSource,
  materializeLibraryCoreFeedBrowseGeneration,
} from "./automerge";
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
      | LibraryCoreFeedBrowsePageRequestV2,
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
    LibraryCoreFeedBrowsePageResponseV1 | LibraryCoreFeedBrowsePageResponseV2
  >;
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

  async readNext(
    limit = LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  ): Promise<
    LibraryCoreFeedBrowsePageResponseV1 | LibraryCoreFeedBrowsePageResponseV2
  > {
    if (this.closed) throw new Error("Library Core browse reader is closed");
    if (this.exhausted) throw new Error("Library Core browse reader is exhausted");
    this.cancellationId = newOperationId("browse-cancel");
    const requestBase = {
      cancellationId: this.cancellationId,
      cursor: this.cursor,
      filter: this.filter,
      limit,
      rankingClockMs: this.rankingClockMs,
      readerSessionId: this.readerSessionId,
      recommendationOrderSchemaVersion:
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    };
    if (this.identityMode === "friends") {
      const request: LibraryCoreFeedBrowsePageRequestV2 = {
        ...requestBase,
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
    const request: LibraryCoreFeedBrowsePageRequestV1 = {
      ...requestBase,
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
    };
    const raw = await this.native.read(request);
    const parsed = parseLibraryCoreFeedBrowsePageResponseV1(raw, request);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
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

const PLATFORMS = new Set<Platform>([
  "x",
  "rss",
  "youtube",
  "reddit",
  "mastodon",
  "github",
  "facebook",
  "instagram",
  "linkedin",
  "substack",
  "medium",
  "saved",
]);
const CONTENT_TYPES = new Set<ContentType>([
  "post",
  "story",
  "article",
  "video",
  "podcast",
]);
const MEDIA_TYPES = new Set<MediaType>(["image", "video", "link"]);
export const LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY =
  "freed.libraryCore.feedBrowseReaderV1.disabled";
export const LIBRARY_CORE_FRIENDS_FEED_READER_DISABLED_KEY =
  "freed.libraryCore.friendsFeedReaderV1.disabled";

export function feedCardToItem(card: LibraryCoreFeedCardV1): FeedItem {
  const platform = PLATFORMS.has(card.platform as Platform)
    ? (card.platform as Platform)
    : "saved";
  const contentType = CONTENT_TYPES.has(card.contentType as ContentType)
    ? (card.contentType as ContentType)
    : "post";
  const publishedAt = card.publishedAt ?? 0;
  const capturedAt = card.capturedAt ?? publishedAt;
  return {
    globalId: card.globalId,
    platform,
    contentType,
    capturedAt,
    publishedAt,
    author: {
      id: card.authorId ?? "",
      handle: card.authorHandle ?? "",
      displayName: card.authorDisplayName ?? card.authorHandle ?? "",
      ...(card.authorAvatarUrl ? { avatarUrl: card.authorAvatarUrl } : {}),
    },
    content: {
      ...(card.contentText ? { text: card.contentText } : {}),
      mediaUrls: [...card.mediaUrls],
      mediaTypes: card.mediaTypes.filter(
        (value): value is MediaType => MEDIA_TYPES.has(value as MediaType),
      ),
      ...(card.linkPreviewTitle && card.sourceUrl
        ? {
            linkPreview: {
              url: card.sourceUrl,
              title: card.linkPreviewTitle,
            },
          }
        : {}),
    },
    ...(card.engagementLikes !== null || card.engagementComments !== null
      ? {
          engagement: {
            ...(card.engagementLikes !== null
              ? { likes: card.engagementLikes }
              : {}),
            ...(card.engagementComments !== null
              ? { comments: card.engagementComments }
              : {}),
          },
        }
      : {}),
    ...(card.locationName
      ? {
          location: {
            name: card.locationName,
            source: "text_extraction" as const,
          },
        }
      : {}),
    userState: {
      hidden: false,
      ...(card.readAt !== null ? { readAt: card.readAt } : {}),
      saved: card.saved === true,
      archived: card.archived === true,
      tags: [...card.tags],
      ...(card.liked !== null ? { liked: card.liked } : {}),
      ...(card.likedAt !== null ? { likedAt: card.likedAt } : {}),
      ...(card.likedSyncedAt !== null
        ? { likedSyncedAt: card.likedSyncedAt }
        : {}),
    },
    topics: [],
    ...(card.contentSignalTags.length > 0
      ? {
          contentSignals: {
            version: 1,
            method: "rules" as const,
            inferredAt: capturedAt,
            scores: {},
            tags: [...card.contentSignalTags] as ContentSignal[],
          },
        }
      : {}),
    ...(card.eventStartsAt !== null
      ? {
          eventCandidate: {
            version: 1,
            method: "rules" as const,
            detectedAt: capturedAt,
            confidence: (card.eventConfidenceBasisPoints ?? 0) / 10_000,
            startsAt: card.eventStartsAt,
            ...(card.locationName ? { locationName: card.locationName } : {}),
          },
        }
      : {}),
    ...(card.sourceUrl ? { sourceUrl: card.sourceUrl } : {}),
  };
}

export async function openBoundedDesktopFeedReader(
  filter: LibraryCoreFeedBrowseFilterInputV1,
  rankingClockMs: number,
): Promise<{
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  close(): Promise<void>;
}> {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_FEED_BROWSE_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core bounded feed reader is disabled");
  }
  const session = await openLibraryCoreFeedBrowseReader(filter, rankingClockMs);
  return {
    totalCount: session.totalCount,
    async readNext() {
      const page = await session.readNext();
      return page.rows.map(feedCardToItem);
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
      return page.rows.map(feedCardToItem);
    },
    close() {
      return session.close();
    },
  };
}
