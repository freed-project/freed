import {
  calculatePriority,
  mergeDefaultPreferences,
  type FeedItem,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedCardV1,
  projectLibraryCoreFeedCardV1,
  type LibraryCoreFeedBrowseFilterInputV1,
} from "@freed/shared/library-core";

import type {
  DocState,
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreFeedBrowseProjectedRowV1,
  LibraryCoreFeedBrowseProjectionBatchV1,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";
import type {
  LibraryCoreFeedBrowseProjectionStartedV1,
  LibraryCoreFeedBrowseProjectionWorkerClient,
} from "./library-core-feed-browse-materializer-runtime";
import type { LibraryCoreItemScanSession } from "./library-core-item-detail-runtime";

const MAXIMUM_ROWS = 250_000;
const MAXIMUM_BATCH_ROWS = 128;
const GENERATION_DOMAIN =
  "freed-desktop-library-core-feed-browse-generation-v1";

interface HydratedProjectionSession {
  readonly sessionId: string;
  readonly state: DocState;
  readonly source: LibraryCoreProjectionSourceV1;
  readonly sourceSequenceById: ReadonlyMap<string, number>;
  readonly weights: ReturnType<typeof mergeDefaultPreferences>["weights"];
  readonly priorityContext: ReturnType<typeof buildPriorityContext>;
  readonly started: LibraryCoreFeedBrowseProjectionStartedV1;
  nextItemIndex: number;
  nextBatchIndex: number;
  projectedRows: number;
  lastBatch: LibraryCoreFeedBrowseProjectionBatchV1 | null;
  complete: boolean;
}

interface ScannedProjectionSession {
  readonly sessionId: string;
  readonly state: DocState;
  readonly source: LibraryCoreProjectionSourceV1;
  readonly sourceSequenceById: ReadonlyMap<string, number> | null;
  readonly weights: ReturnType<typeof mergeDefaultPreferences>["weights"];
  readonly priorityContext: ReturnType<typeof buildPriorityContext>;
  readonly started: LibraryCoreFeedBrowseProjectionStartedV1;
  scan: LibraryCoreItemScanSession | null;
  nextBatchIndex: number;
  projectedRows: number;
  lastBatch: LibraryCoreFeedBrowseProjectionBatchV1 | null;
  complete: boolean;
}

export interface LibraryCoreScannedFeedBrowseProjectionStrategy {
  readonly generationDomain: string;
  bindingFilterJson(
    filter: ReturnType<typeof normalizeLibraryCoreFeedBrowseFilterV1>,
  ): string;
  projectRow(input: {
    readonly item: FeedItem;
    readonly recommendationPriority: number;
  }): LibraryCoreFeedBrowseProjectedRowV1;
}

function buildPriorityContext(state: DocState) {
  const personByAuthorKey = new Map<
    string,
    DocState["persons"][string] | null
  >();
  for (const account of Object.values(state.accounts)) {
    if (account.kind !== "social") continue;
    personByAuthorKey.set(
      `${account.provider}:${account.externalId}`,
      account.personId ? (state.persons[account.personId] ?? null) : null,
    );
  }
  return {
    accounts: state.accounts,
    persons: state.persons,
    personByAuthorKey,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function sameSource(
  left: LibraryCoreProjectionSourceV1,
  right: LibraryCoreProjectionSourceV1,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.documentId === right.documentId &&
    left.headsDigest === right.headsDigest &&
    left.headCount === right.headCount &&
    left.storageRevision.generation === right.storageRevision.generation &&
    left.storageRevision.saveRevision === right.storageRevision.saveRevision
  );
}

function buildSourceSequence(state: DocState): ReadonlyMap<string, number> {
  const ids = state.feedSourceOrderIds;
  if (!ids || ids.length !== state.docItemCount) {
    throw new Error("Hydrated feed source order is unavailable");
  }
  const sequenceById = new Map<string, number>();
  ids.forEach((globalId, index) => {
    if (
      !globalId ||
      sequenceById.has(globalId) ||
      !Number.isSafeInteger(index)
    ) {
      throw new Error("Hydrated feed source order is invalid");
    }
    sequenceById.set(globalId, index);
  });
  return sequenceById;
}

function projectRow(
  item: FeedItem,
  sourceSequenceById: ReadonlyMap<string, number>,
  weights: ReturnType<typeof mergeDefaultPreferences>["weights"],
  priorityContext: ReturnType<typeof buildPriorityContext>,
  rankingClockMs: number,
): LibraryCoreFeedBrowseProjectedRowV1 {
  const parsedCard = parseLibraryCoreFeedCardV1(
    projectLibraryCoreFeedCardV1(item),
  );
  if (!parsedCard.ok) throw new Error(parsedCard.error);
  const sourceSequence = sourceSequenceById.get(item.globalId);
  if (sourceSequence === undefined) {
    throw new Error("Library Core feed item has no source sequence");
  }
  return {
    priority: calculatePriority(item, weights, rankingClockMs, priorityContext),
    publishedAt: parsedCard.value.publishedAt ?? 0,
    sourceSequence,
    globalId: item.globalId,
    cardJson: JSON.stringify(parsedCard.value),
  };
}

async function buildStartedProjection(
  sessionId: string,
  source: LibraryCoreProjectionSourceV1,
  filter: ReturnType<typeof normalizeLibraryCoreFeedBrowseFilterV1>,
  rankingClockMs: number,
  totalRows: number,
  strategy?: LibraryCoreScannedFeedBrowseProjectionStrategy,
): Promise<LibraryCoreFeedBrowseProjectionStartedV1> {
  const bindingFilterJson =
    strategy?.bindingFilterJson(filter) ?? JSON.stringify(filter);
  const binding: LibraryCoreFeedBrowseGenerationBindingV1 = {
    generationId: await sha256Hex(
      JSON.stringify({
        domain: strategy?.generationDomain ?? GENERATION_DOMAIN,
        documentId: source.documentId,
        ...(strategy ? { bindingFilterJson } : { filter }),
        headCount: source.headCount,
        headsDigest: source.headsDigest,
        projectionRevision: source.storageRevision.saveRevision,
        rankingClockMs,
        recommendationOrderSchemaVersion:
          LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
        transitionSequence: source.storageRevision.generation,
      }),
    ),
    sourceDocumentId: source.documentId,
    sourceHeadsDigest: source.headsDigest,
    sourceHeadCount: source.headCount,
    transitionSequence: source.storageRevision.generation,
    projectionRevision: source.storageRevision.saveRevision,
    filterJson: bindingFilterJson,
    rankingClockMs,
    recommendationOrderSchemaVersion:
      LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    totalRows,
  };
  return {
    type: "LIBRARY_CORE_FEED_BROWSE_PROJECTION_STARTED",
    reqId: 0,
    sessionId,
    binding,
    filter,
    nextBatchIndex: 0,
    projectedRows: 0,
    maximumBatchRows: MAXIMUM_BATCH_ROWS,
  };
}

/**
 * Project the already-hydrated, plain feed state into bounded native pages.
 *
 * Startup has already paid to create this exact renderer state. Reusing it
 * avoids a second traversal of Automerge proxies, which was the source of the
 * multi-gigabyte Gate D spike. SQLite still receives only replayable 128-row
 * pages, and any state movement invalidates the session before publication.
 */
export function createHydratedLibraryCoreFeedBrowseProjectionClient({
  getSource,
  getState,
}: {
  getSource(): Promise<LibraryCoreProjectionSourceV1>;
  getState(): DocState | null;
}): LibraryCoreFeedBrowseProjectionWorkerClient {
  let session: HydratedProjectionSession | null = null;

  return {
    async begin(
      sessionId: string,
      filterInput: LibraryCoreFeedBrowseFilterInputV1 | undefined,
      rankingClockMs: number,
    ) {
      if (!Number.isSafeInteger(rankingClockMs) || rankingClockMs < 0) {
        throw new Error("Library Core browse ranking clock is invalid");
      }
      const state = getState();
      if (!state) throw new Error("Hydrated feed state is unavailable");
      const source = await getSource();
      if (getState() !== state) {
        throw new Error("Library Core browse projection source changed");
      }
      const filter = normalizeLibraryCoreFeedBrowseFilterV1(filterInput);
      if (filter.showHidden) {
        throw new Error("Hydrated feed projection cannot include hidden items");
      }
      const sourceSequenceById = buildSourceSequence(state);
      let totalRows = 0;
      for (const item of state.items) {
        if (!matchesLibraryCoreFeedBrowseFilterV1(item, filter)) continue;
        totalRows += 1;
        if (totalRows > MAXIMUM_ROWS) {
          throw new Error(
            `Library Core browse projection exceeds ${MAXIMUM_ROWS.toLocaleString()} rows`,
          );
        }
      }
      const started = await buildStartedProjection(
        sessionId,
        source,
        filter,
        rankingClockMs,
        totalRows,
      );
      if (session && !session.complete) {
        if (session.sessionId !== sessionId) {
          throw new Error(
            `Library Core browse projection session ${session.sessionId} is already active`,
          );
        }
        if (
          session.state !== state ||
          !sameSource(session.source, source) ||
          session.started.binding.generationId !== started.binding.generationId
        ) {
          session = null;
          throw new Error("Library Core browse projection source changed");
        }
        return session.started;
      }
      session = {
        sessionId,
        state,
        source,
        sourceSequenceById,
        weights: mergeDefaultPreferences(state.preferences).weights,
        priorityContext: buildPriorityContext(state),
        started,
        nextItemIndex: 0,
        nextBatchIndex: 0,
        projectedRows: 0,
        lastBatch: null,
        complete: false,
      };
      return started;
    },

    async nextBatch(sessionId: string, batchIndex: number) {
      const active = session;
      if (!active || active.sessionId !== sessionId) {
        throw new Error("Library Core browse projection session is not active");
      }
      if (active.lastBatch?.batchIndex === batchIndex) {
        return active.lastBatch;
      }
      if (
        active.complete ||
        batchIndex !== active.nextBatchIndex ||
        getState() !== active.state ||
        !sameSource(await getSource(), active.source)
      ) {
        session = null;
        throw new Error("Library Core browse projection source changed");
      }

      const rows: LibraryCoreFeedBrowseProjectedRowV1[] = [];
      while (
        rows.length < MAXIMUM_BATCH_ROWS &&
        active.nextItemIndex < active.state.items.length
      ) {
        const item: FeedItem = active.state.items[active.nextItemIndex];
        active.nextItemIndex += 1;
        if (
          !matchesLibraryCoreFeedBrowseFilterV1(item, active.started.filter)
        ) {
          continue;
        }
        try {
          rows.push(
            projectRow(
              item,
              active.sourceSequenceById,
              active.weights,
              active.priorityContext,
              active.started.binding.rankingClockMs,
            ),
          );
        } catch (error) {
          session = null;
          throw error;
        }
      }
      const done = active.nextItemIndex === active.state.items.length;
      active.projectedRows += rows.length;
      if (
        active.projectedRows > active.started.binding.totalRows ||
        (done && active.projectedRows !== active.started.binding.totalRows)
      ) {
        session = null;
        throw new Error("Library Core browse projection row count changed");
      }
      const batch: LibraryCoreFeedBrowseProjectionBatchV1 = {
        sessionId,
        binding: active.started.binding,
        batchIndex,
        rows,
        projectedRows: active.projectedRows,
        done,
      };
      active.nextBatchIndex += 1;
      active.lastBatch = batch;
      active.complete = done;
      return batch;
    },

    async cancel(sessionId: string) {
      if (session?.sessionId === sessionId) session = null;
    },
  };
}

/**
 * Project one authenticated SQLite shadow generation into the query-specific
 * browse store without traversing or retaining the renderer's item corpus.
 * The source is scanned once to count matching rows and once to emit bounded
 * pages because the native generation protocol binds its exact row count at
 * begin time.
 */
export function createScannedLibraryCoreFeedBrowseProjectionClient({
  getSource,
  getState,
  openScan,
  strategy,
}: {
  getSource(): Promise<LibraryCoreProjectionSourceV1>;
  getState(): DocState | null;
  openScan(): Promise<LibraryCoreItemScanSession>;
  strategy?: LibraryCoreScannedFeedBrowseProjectionStrategy;
}): LibraryCoreFeedBrowseProjectionWorkerClient {
  let session: ScannedProjectionSession | null = null;

  const discard = async (): Promise<void> => {
    const active = session;
    session = null;
    if (active?.scan) await active.scan.close().catch(() => undefined);
  };

  return {
    async begin(sessionId, filterInput, rankingClockMs) {
      if (!Number.isSafeInteger(rankingClockMs) || rankingClockMs < 0) {
        throw new Error("Library Core browse ranking clock is invalid");
      }
      const state = getState();
      if (!state) throw new Error("Hydrated feed metadata is unavailable");
      const source = await getSource();
      if (getState() !== state) {
        throw new Error("Library Core browse projection source changed");
      }
      const filter = normalizeLibraryCoreFeedBrowseFilterV1(filterInput);
      if (filter.showHidden) {
        throw new Error("SQLite feed projection cannot include hidden items");
      }
      const bindingFilterJson =
        strategy?.bindingFilterJson(filter) ?? JSON.stringify(filter);
      if (session && !session.complete) {
        if (session.sessionId !== sessionId) {
          throw new Error(
            `Library Core browse projection session ${session.sessionId} is already active`,
          );
        }
        if (
          session.state !== state ||
          !sameSource(session.source, source) ||
          session.started.binding.filterJson !== bindingFilterJson ||
          session.started.binding.rankingClockMs !== rankingClockMs
        ) {
          await discard();
          throw new Error("Library Core browse projection source changed");
        }
        return session.started;
      }
      // Custom query strategies define their own total order. Avoid retaining
      // the ordinary browse reader's O(corpus) ID-to-sequence map for them.
      const sourceSequenceById = strategy ? null : buildSourceSequence(state);
      let totalRows = 0;
      const countScan = await openScan();
      try {
        while (true) {
          const page = await countScan.nextPage();
          for (const item of page.items) {
            if (!matchesLibraryCoreFeedBrowseFilterV1(item, filter)) continue;
            totalRows += 1;
            if (totalRows > MAXIMUM_ROWS) {
              throw new Error(
                `Library Core browse projection exceeds ${MAXIMUM_ROWS.toLocaleString()} rows`,
              );
            }
          }
          if (page.done) break;
        }
      } finally {
        await countScan.close().catch(() => undefined);
      }
      if (getState() !== state || !sameSource(await getSource(), source)) {
        throw new Error("Library Core browse projection source changed");
      }
      const started = await buildStartedProjection(
        sessionId,
        source,
        filter,
        rankingClockMs,
        totalRows,
        strategy,
      );
      session = {
        sessionId,
        state,
        source,
        sourceSequenceById,
        weights: mergeDefaultPreferences(state.preferences).weights,
        priorityContext: buildPriorityContext(state),
        started,
        scan: null,
        nextBatchIndex: 0,
        projectedRows: 0,
        lastBatch: null,
        complete: false,
      };
      return started;
    },

    async nextBatch(sessionId, batchIndex) {
      const active = session;
      if (!active || active.sessionId !== sessionId) {
        throw new Error("Library Core browse projection session is not active");
      }
      if (active.lastBatch?.batchIndex === batchIndex) {
        return active.lastBatch;
      }
      if (
        active.complete ||
        batchIndex !== active.nextBatchIndex ||
        getState() !== active.state ||
        !sameSource(await getSource(), active.source)
      ) {
        await discard();
        throw new Error("Library Core browse projection source changed");
      }
      active.scan ??= await openScan();
      const rows: LibraryCoreFeedBrowseProjectedRowV1[] = [];
      let done = false;
      try {
        // Emit at most one nonempty source page per writer batch. The native
        // item scanner already caps each page at 64 rows, so this preserves a
        // hard transfer ceiling without retaining a cross-page buffer. Empty
        // filtered pages are skipped until a row or the terminal page appears.
        while (rows.length === 0 && !done) {
          const page = await active.scan.nextPage();
          done = page.done;
          for (const item of page.items) {
            if (
              !matchesLibraryCoreFeedBrowseFilterV1(item, active.started.filter)
            ) {
              continue;
            }
            if (strategy) {
              rows.push(
                strategy.projectRow({
                  item,
                  recommendationPriority: calculatePriority(
                    item,
                    active.weights,
                    active.started.binding.rankingClockMs,
                    active.priorityContext,
                  ),
                }),
              );
              continue;
            }
            const sourceSequenceById = active.sourceSequenceById;
            if (!sourceSequenceById) {
              throw new Error("Library Core feed source order is unavailable");
            }
            rows.push(
              projectRow(
                item,
                sourceSequenceById,
                active.weights,
                active.priorityContext,
                active.started.binding.rankingClockMs,
              ),
            );
          }
          if (rows.length > MAXIMUM_BATCH_ROWS) {
            throw new Error(
              "Library Core browse projection batch is oversized",
            );
          }
        }
      } catch (error) {
        await discard();
        throw error;
      }
      active.projectedRows += rows.length;
      if (
        active.projectedRows > active.started.binding.totalRows ||
        (done && active.projectedRows !== active.started.binding.totalRows)
      ) {
        await discard();
        throw new Error("Library Core browse projection row count changed");
      }
      const batch: LibraryCoreFeedBrowseProjectionBatchV1 = {
        sessionId,
        binding: active.started.binding,
        batchIndex,
        rows,
        projectedRows: active.projectedRows,
        done,
      };
      active.nextBatchIndex += 1;
      active.lastBatch = batch;
      active.complete = done;
      if (done) {
        await active.scan.close().catch(() => undefined);
        active.scan = null;
      }
      return batch;
    },

    async cancel(sessionId) {
      if (session?.sessionId === sessionId) await discard();
    },
  };
}
