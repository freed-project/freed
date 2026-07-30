import {
  calculatePriority,
  mergeDefaultPreferences,
  type FeedItem,
} from "@freed/shared";
import type { FreedDoc } from "@freed/shared/schema";
import {
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  projectLibraryCoreFeedCardV1,
  type LibraryCoreFeedBrowseFilterInputV1,
  type LibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedPageSourceV1,
} from "@freed/shared/library-core";

import {
  derivePwaLibraryCoreFeedGenerationSource,
  type CommittedAutomergeFeedSource,
} from "./library-core-feed-materializer";
import type {
  AppendPwaLibraryCoreBrowseGenerationPageInput,
  BeginPwaLibraryCoreBrowseGenerationInput,
  PwaLibraryCoreBrowseProjectedRowV1,
  PwaLibraryCoreFeedGenerationState,
} from "./library-core-feed-reader-runtime";

const MATERIALIZATION_PAGE_ROWS = 128;
const SOURCE_DOMAIN = "freed-pwa-library-core-feed-browse-generation-v1";

interface PwaLibraryCoreBrowseGenerationWriter {
  beginBrowseGeneration(
    input: BeginPwaLibraryCoreBrowseGenerationInput,
  ): Promise<PwaLibraryCoreFeedGenerationState>;
  appendBrowseGenerationPage(
    input: AppendPwaLibraryCoreBrowseGenerationPageInput,
  ): Promise<void>;
  finalizeBrowseGeneration(source: LibraryCoreFeedPageSourceV1): Promise<void>;
}

export interface MaterializePwaLibraryCoreFeedBrowseGenerationInput {
  readonly committed: CommittedAutomergeFeedSource;
  readonly document: FreedDoc;
  readonly filter?: LibraryCoreFeedBrowseFilterInputV1;
  readonly rankingClockMs: number;
  readonly subtle: SubtleCrypto;
  readonly writer: PwaLibraryCoreBrowseGenerationWriter;
}

export interface MaterializePwaLibraryCoreFeedBrowseGenerationResult {
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly rankingClockMs: number;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

function feedItemsOf(document: FreedDoc): Record<string, FeedItem> {
  const feedItems = document.feedItems;
  if (
    typeof feedItems !== "object" ||
    feedItems === null ||
    Array.isArray(feedItems)
  ) {
    throw new TypeError("committed Automerge feedItems must be one map");
  }
  return feedItems as Record<string, FeedItem>;
}

function checkedFeedItem(
  feedItems: Record<string, FeedItem>,
  globalId: string,
): FeedItem {
  const item = feedItems[globalId];
  if (
    typeof item !== "object" ||
    item === null ||
    Array.isArray(item) ||
    item.globalId !== globalId
  ) {
    throw new TypeError(
      "committed Automerge feed item identity does not match its map key",
    );
  }
  return item;
}

/**
 * Materialize one query-specific browser generation from the exact committed
 * Automerge frontier.
 *
 * The shared filter runs before projection. Priority is frozen at one safe
 * clock, while IndexedDB receives the exact priority, published-time, source
 * sequence tuple needed to reproduce the current recommendation order without
 * a corpus-sized array or sort in application memory.
 */
export async function materializePwaLibraryCoreFeedBrowseGeneration(
  input: MaterializePwaLibraryCoreFeedBrowseGenerationInput,
): Promise<MaterializePwaLibraryCoreFeedBrowseGenerationResult> {
  if (
    !Number.isSafeInteger(input.rankingClockMs) ||
    input.rankingClockMs < 0
  ) {
    throw new TypeError("browse ranking clock must be nonnegative and safe");
  }
  const filter = normalizeLibraryCoreFeedBrowseFilterV1(input.filter);
  const source = await derivePwaLibraryCoreFeedGenerationSource(
    input.committed,
    input.subtle,
    SOURCE_DOMAIN,
    {
      filter,
      rankingClockMs: input.rankingClockMs,
      recommendationOrderSchemaVersion:
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    },
  );
  const feedItems = feedItemsOf(input.document);
  let totalCount = 0;
  for (const globalId in feedItems) {
    if (!Object.prototype.hasOwnProperty.call(feedItems, globalId)) continue;
    if (!matchesLibraryCoreFeedBrowseFilterV1(
      checkedFeedItem(feedItems, globalId),
      filter,
    )) {
      continue;
    }
    totalCount += 1;
    if (!Number.isSafeInteger(totalCount)) {
      throw new RangeError("browse feed item count exceeds safe integer range");
    }
  }

  const state = await input.writer.beginBrowseGeneration({
    source,
    totalCount,
  });
  if (state === "complete") {
    await input.writer.finalizeBrowseGeneration(source);
    return Object.freeze({
      filter,
      rankingClockMs: input.rankingClockMs,
      source,
      totalCount,
    });
  }

  const preferences = mergeDefaultPreferences(input.document.preferences);
  const personByAuthorKey = new Map<
    string,
    (typeof input.document.persons)[string] | null
  >();
  for (const accountId in input.document.accounts) {
    if (
      !Object.prototype.hasOwnProperty.call(
        input.document.accounts,
        accountId,
      )
    ) {
      continue;
    }
    const account = input.document.accounts[accountId];
    if (account.kind !== "social") continue;
    personByAuthorKey.set(
      `${account.provider}:${account.externalId}`,
      account.personId
        ? input.document.persons[account.personId] ?? null
        : null,
    );
  }
  const context = {
    accounts: input.document.accounts,
    personByAuthorKey,
    persons: input.document.persons,
  };
  let batchIndex = 0;
  let sourceSequence = 0;
  let rows: PwaLibraryCoreBrowseProjectedRowV1[] = [];
  const flush = async (): Promise<void> => {
    if (rows.length === 0) return;
    const page = Object.freeze(rows);
    rows = [];
    await input.writer.appendBrowseGenerationPage({
      batchIndex,
      rows: page,
      source,
    });
    batchIndex += 1;
  };

  for (const globalId in feedItems) {
    if (!Object.prototype.hasOwnProperty.call(feedItems, globalId)) continue;
    const item = checkedFeedItem(feedItems, globalId);
    const itemSourceSequence = sourceSequence;
    sourceSequence += 1;
    if (!Number.isSafeInteger(sourceSequence)) {
      throw new RangeError(
        "browse feed source sequence exceeds safe integer range",
      );
    }
    if (!matchesLibraryCoreFeedBrowseFilterV1(item, filter)) continue;
    rows.push(Object.freeze({
      priority: calculatePriority(
        item,
        preferences.weights,
        input.rankingClockMs,
        context,
      ),
      row: projectLibraryCoreFeedCardV1(item),
      sourceSequence: itemSourceSequence,
    }));
    if (rows.length === MATERIALIZATION_PAGE_ROWS) await flush();
  }
  await flush();
  await input.writer.finalizeBrowseGeneration(source);
  return Object.freeze({
    filter,
    rankingClockMs: input.rankingClockMs,
    source,
    totalCount,
  });
}
