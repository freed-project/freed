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

function buildPriorityContext(state: DocState) {
  const personByAuthorKey = new Map<
    string,
    DocState["persons"][string] | null
  >();
  for (const account of Object.values(state.accounts)) {
    if (account.kind !== "social") continue;
    personByAuthorKey.set(
      `${account.provider}:${account.externalId}`,
      account.personId ? state.persons[account.personId] ?? null : null,
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
    byte.toString(16).padStart(2, "0")
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

function buildSourceSequence(
  state: DocState,
): ReadonlyMap<string, number> {
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
      const binding: LibraryCoreFeedBrowseGenerationBindingV1 = {
        generationId: await sha256Hex(JSON.stringify({
          domain: GENERATION_DOMAIN,
          documentId: source.documentId,
          filter,
          headCount: source.headCount,
          headsDigest: source.headsDigest,
          projectionRevision: source.storageRevision.saveRevision,
          rankingClockMs,
          recommendationOrderSchemaVersion:
            LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
          transitionSequence: source.storageRevision.generation,
        })),
        sourceDocumentId: source.documentId,
        sourceHeadsDigest: source.headsDigest,
        sourceHeadCount: source.headCount,
        transitionSequence: source.storageRevision.generation,
        projectionRevision: source.storageRevision.saveRevision,
        filterJson: JSON.stringify(filter),
        rankingClockMs,
        recommendationOrderSchemaVersion:
          LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
        totalRows,
      };
      const started: LibraryCoreFeedBrowseProjectionStartedV1 = {
        type: "LIBRARY_CORE_FEED_BROWSE_PROJECTION_STARTED",
        reqId: 0,
        sessionId,
        binding,
        filter,
        nextBatchIndex: 0,
        projectedRows: 0,
        maximumBatchRows: MAXIMUM_BATCH_ROWS,
      };
      if (session && !session.complete) {
        if (session.sessionId !== sessionId) {
          throw new Error(
            `Library Core browse projection session ${session.sessionId} is already active`,
          );
        }
        if (
          session.state !== state ||
          !sameSource(session.source, source) ||
          session.started.binding.generationId !== binding.generationId
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
          !matchesLibraryCoreFeedBrowseFilterV1(
            item,
            active.started.filter,
          )
        ) {
          continue;
        }
        const parsedCard = parseLibraryCoreFeedCardV1(
          projectLibraryCoreFeedCardV1(item),
        );
        if (!parsedCard.ok) {
          session = null;
          throw new Error(parsedCard.error);
        }
        const sourceSequence = active.sourceSequenceById.get(item.globalId);
        if (sourceSequence === undefined) {
          session = null;
          throw new Error("Hydrated feed item has no source sequence");
        }
        rows.push({
          priority: calculatePriority(
            item,
            active.weights,
            active.started.binding.rankingClockMs,
            active.priorityContext,
          ),
          publishedAt: parsedCard.value.publishedAt ?? 0,
          sourceSequence,
          globalId: item.globalId,
          cardJson: JSON.stringify(parsedCard.value),
        });
      }
      const done = active.nextItemIndex === active.state.items.length;
      active.projectedRows += rows.length;
      if (
        active.projectedRows > active.started.binding.totalRows ||
        (done &&
          active.projectedRows !== active.started.binding.totalRows)
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
