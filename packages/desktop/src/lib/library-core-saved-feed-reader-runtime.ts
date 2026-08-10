import { invoke } from "@tauri-apps/api/core";
import {
  type FeedItem,
  type FilterOptions,
  type SavedContentSortMode,
} from "@freed/shared";
import {
  LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID,
  LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION,
  LIBRARY_CORE_SAVED_FEED_SORT_ORDER_SCHEMA_VERSION,
  LIBRARY_CORE_SAVED_FEED_SORT_ORDER_V1,
  isLibraryCoreOperationInstanceId,
  libraryCoreFeedCardToItemV1,
  libraryCoreSavedFeedSortKeyV1,
  parseLibraryCoreSavedFeedPageResponseV1,
  projectLibraryCoreSavedFeedCardV1,
  type LibraryCoreOperationInstanceId,
  type LibraryCoreSavedFeedPageRequestV1,
  type LibraryCoreSavedFeedPageResponseV1,
} from "@freed/shared/library-core";

import { getDocState, getLibraryCoreProjectionSource } from "./automerge";
import type {
  DocState,
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";
import {
  createScannedLibraryCoreFeedBrowseProjectionClient,
  type LibraryCoreScannedFeedBrowseProjectionStrategy,
} from "./library-core-feed-browse-hydrated-client";
import {
  materializeDesktopLibraryCoreFeedBrowseGeneration,
  type LibraryCoreFeedBrowseGenerationStatusV1,
  type LibraryCoreFeedBrowseNativeClient,
} from "./library-core-feed-browse-materializer-runtime";
import {
  openBoundedDesktopFeedReader,
} from "./library-core-feed-browse-reader-runtime";
import { isSqliteLibraryActive } from "./sqlite-library";
import {
  openLibraryCoreItemScanSession,
  type LibraryCoreItemScanSession,
} from "./library-core-item-detail-runtime";

export const LIBRARY_CORE_SAVED_FEED_READER_DISABLED_KEY =
  "freed.libraryCore.savedFeedReaderV1.disabled";

export interface SelectedLibraryCoreSavedFeedGenerationV1 {
  readonly binding: LibraryCoreFeedBrowseGenerationBindingV1;
  readonly byteLength: number;
  readonly fileDigest: string;
  readonly selectionSequence: number;
}

export interface LibraryCoreSavedFeedNativeClient extends LibraryCoreFeedBrowseNativeClient {
  getSelection(): Promise<SelectedLibraryCoreSavedFeedGenerationV1 | null>;
  select(input: {
    binding: LibraryCoreFeedBrowseGenerationBindingV1;
    transitionId: string;
    expectedCurrentGenerationId: string | null;
  }): Promise<SelectedLibraryCoreSavedFeedGenerationV1>;
  read(request: LibraryCoreSavedFeedPageRequestV1): Promise<unknown>;
  cancelReader(readerSessionId: string, cancellationId: string): Promise<void>;
}

export const tauriLibraryCoreSavedFeedNativeClient: LibraryCoreSavedFeedNativeClient =
  {
    begin(input) {
      return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
        "begin_library_core_saved_feed_generation",
        input,
      );
    },
    append(batch) {
      return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
        "append_library_core_saved_feed_generation_page",
        {
          batch: {
            sessionId: batch.sessionId,
            batchIndex: batch.batchIndex,
            rows: batch.rows,
          },
        },
      );
    },
    finalize(sessionId) {
      return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
        "finalize_library_core_saved_feed_generation",
        { sessionId },
      );
    },
    cancel(sessionId) {
      return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
        "cancel_library_core_saved_feed_generation",
        { sessionId },
      );
    },
    getSelection() {
      return invoke<SelectedLibraryCoreSavedFeedGenerationV1 | null>(
        "get_library_core_saved_feed_selection",
      );
    },
    select(input) {
      return invoke<SelectedLibraryCoreSavedFeedGenerationV1>(
        "select_library_core_saved_feed_generation",
        { input },
      );
    },
    read(request) {
      return invoke("read_library_core_saved_feed_page", { request });
    },
    async cancelReader(readerSessionId, cancellationId) {
      await invoke("cancel_library_core_saved_feed_reader", {
        readerSessionId,
        cancellationId,
      });
    },
  };

export interface LibraryCoreSavedFeedReaderDependencies {
  getSource(): Promise<LibraryCoreProjectionSourceV1>;
  getState(): DocState | null;
  openScan(): Promise<LibraryCoreItemScanSession>;
  readonly native: LibraryCoreSavedFeedNativeClient;
}

const defaultDependencies: LibraryCoreSavedFeedReaderDependencies = {
  getSource: getLibraryCoreProjectionSource,
  getState: getDocState,
  openScan: () =>
    openLibraryCoreItemScanSession(getLibraryCoreProjectionSource),
  native: tauriLibraryCoreSavedFeedNativeClient,
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
  selected: SelectedLibraryCoreSavedFeedGenerationV1,
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
    throw new Error("Library Core selected Saved generation is invalid");
  }
}

function savedStrategy(
  sortMode: SavedContentSortMode,
): LibraryCoreScannedFeedBrowseProjectionStrategy {
  return {
    generationDomain: LIBRARY_CORE_SAVED_FEED_SORT_ORDER_V1.generationDomain,
    bindingFilterJson(filter) {
      return JSON.stringify({
        filter,
        sortMode,
        sortOrderSchemaVersion:
          LIBRARY_CORE_SAVED_FEED_SORT_ORDER_SCHEMA_VERSION,
      });
    },
    projectRow({ item, recommendationPriority }) {
      const key = libraryCoreSavedFeedSortKeyV1(
        item,
        sortMode,
        recommendationPriority,
      );
      const card = projectLibraryCoreSavedFeedCardV1(item);
      return {
        priority: key.sortGroup,
        publishedAt: key.sortPrimary,
        sourceSequence: key.sortSecondary,
        globalId: key.globalId,
        cardJson: JSON.stringify(card),
      };
    },
  };
}

function savedCardToItem(
  card: LibraryCoreSavedFeedPageResponseV1["rows"][number],
): FeedItem {
  const item = libraryCoreFeedCardToItemV1(card);
  return {
    ...item,
    ...(card.readingTimeMinutes === null
      ? {}
      : {
          preservedContent: {
            text: "",
            wordCount: 0,
            readingTime: card.readingTimeMinutes,
            preservedAt: item.capturedAt,
          },
        }),
    userState: {
      ...item.userState,
      ...(card.savedAt === null ? {} : { savedAt: card.savedAt }),
    },
  };
}

class DesktopSavedFeedReaderSession {
  private cursor: string | null = null;
  private exhausted = false;
  private closed = false;
  private cancellationId = newOperationId("saved-feed-cancel");

  constructor(
    private readonly native: LibraryCoreSavedFeedNativeClient,
    private readonly readerSessionId: LibraryCoreOperationInstanceId,
    private readonly filter: LibraryCoreSavedFeedPageRequestV1["filter"],
    private readonly sortMode: SavedContentSortMode,
    private readonly rankingClockMs: number,
    readonly totalCount: number,
  ) {}

  async readNext(): Promise<readonly FeedItem[]> {
    if (this.closed) throw new Error("Library Core Saved reader is closed");
    if (this.exhausted) return [];
    this.cancellationId = newOperationId("saved-feed-cancel");
    const request: LibraryCoreSavedFeedPageRequestV1 = {
      cancellationId: this.cancellationId,
      cursor: this.cursor,
      filter: this.filter,
      limit: LIBRARY_CORE_SAVED_FEED_PAGE_MAXIMUM_LIMIT,
      queryId: LIBRARY_CORE_SAVED_FEED_PAGE_QUERY_ID,
      rankingClockMs: this.rankingClockMs,
      readerSessionId: this.readerSessionId,
      schemaVersion: LIBRARY_CORE_SAVED_FEED_PAGE_SCHEMA_VERSION,
      sortMode: this.sortMode,
    };
    const parsed = parseLibraryCoreSavedFeedPageResponseV1(
      await this.native.read(request),
      request,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    this.cursor = parsed.value.nextCursor;
    this.exhausted = this.cursor === null;
    return parsed.value.rows.map(savedCardToItem);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.native.cancelReader(this.readerSessionId, this.cancellationId);
  }
}

let savedGenerationTurn: Promise<void> = Promise.resolve();

async function materializeSavedGeneration(
  filter: FilterOptions,
  sortMode: SavedContentSortMode,
  rankingClockMs: number,
  dependencies: LibraryCoreSavedFeedReaderDependencies,
) {
  let releaseTurn: () => void = () => undefined;
  const predecessor = savedGenerationTurn;
  savedGenerationTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  await predecessor;
  const worker = createScannedLibraryCoreFeedBrowseProjectionClient({
    getSource: dependencies.getSource,
    getState: dependencies.getState,
    openScan: dependencies.openScan,
    strategy: savedStrategy(sortMode),
  });
  try {
    return await materializeDesktopLibraryCoreFeedBrowseGeneration(
      worker,
      dependencies.native,
      newOperationId("saved-feed-project"),
      { ...filter, savedOnly: true, showHidden: false },
      rankingClockMs,
    ).then(({ binding, filter: normalizedFilter }) => ({
      binding,
      filter: normalizedFilter,
    }));
  } finally {
    releaseTurn();
  }
}

/**
 * Open one source-fenced, saved-only native generation. The renderer retains
 * at most two 128-row pages while the caller traverses the complete Saved set.
 */
export async function openBoundedDesktopSavedFeedReader(
  filter: FilterOptions,
  sortMode: SavedContentSortMode,
  rankingClockMs: number,
  dependencies: LibraryCoreSavedFeedReaderDependencies = defaultDependencies,
): Promise<{
  readonly totalCount: number;
  readNext(): Promise<readonly FeedItem[]>;
  close(): Promise<void>;
}> {
  if (isSqliteLibraryActive()) {
    const reader = await openBoundedDesktopFeedReader(
      { ...filter, savedOnly: true },
      rankingClockMs,
    );
    return {
      totalCount: reader.totalCount,
      readNext: reader.readNext,
      close: reader.close,
    };
  }
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_SAVED_FEED_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core bounded Saved reader is disabled");
  }
  if (!Number.isSafeInteger(rankingClockMs) || rankingClockMs < 0) {
    throw new Error("Library Core Saved ranking clock is invalid");
  }
  const materialized = await materializeSavedGeneration(
    filter,
    sortMode,
    rankingClockMs,
    dependencies,
  );
  const source = await dependencies.getSource();
  if (!sameProjectionSource(source, materialized.binding)) {
    throw new Error("Library Core Saved source changed before selection");
  }
  const current = await dependencies.native.getSelection();
  const selected = await dependencies.native.select({
    binding: materialized.binding,
    transitionId: newOperationId("saved-feed-select"),
    expectedCurrentGenerationId: current?.binding.generationId ?? null,
  });
  assertSelectedGeneration(selected, materialized.binding);
  const confirmed = await dependencies.getSource();
  if (!sameProjectionSource(confirmed, materialized.binding)) {
    throw new Error("Library Core Saved source changed after selection");
  }
  return new DesktopSavedFeedReaderSession(
    dependencies.native,
    newOperationId("saved-feed-reader"),
    materialized.filter,
    sortMode,
    rankingClockMs,
    materialized.binding.totalRows,
  );
}
