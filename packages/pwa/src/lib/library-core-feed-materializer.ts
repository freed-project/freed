import type { FeedItem } from "@freed/shared";
import type { FreedDoc } from "@freed/shared/schema";
import {
  isLibraryCoreVisibleFeedItemV1,
  projectLibraryCoreFeedCardV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageSourceV1,
} from "@freed/shared/library-core";

import type {
  AppendPwaLibraryCoreFeedGenerationPageInput,
  BeginPwaLibraryCoreFeedGenerationInput,
  PwaLibraryCoreFeedGenerationState,
} from "./library-core-feed-reader-runtime";

const MATERIALIZATION_PAGE_ROWS = 128;
const MAXIMUM_AUTHENTICATED_HEADS = 256;
const SOURCE_DOMAIN = "freed-pwa-library-core-feed-generation-v1";
const TEXT_ENCODER = new TextEncoder();
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

export interface CommittedAutomergeFeedSource {
  readonly heads: readonly string[];
  readonly revision: Readonly<{
    readonly generation: number;
    readonly saveRevision: number;
  }>;
}

interface PwaLibraryCoreFeedGenerationWriter {
  beginGeneration(
    input: BeginPwaLibraryCoreFeedGenerationInput,
  ): Promise<PwaLibraryCoreFeedGenerationState>;
  appendGenerationPage(
    input: AppendPwaLibraryCoreFeedGenerationPageInput,
  ): Promise<void>;
  finalizeGeneration(source: LibraryCoreFeedPageSourceV1): Promise<void>;
}

export interface MaterializePwaLibraryCoreFeedGenerationInput {
  readonly committed: CommittedAutomergeFeedSource;
  readonly document: FreedDoc;
  readonly subtle: SubtleCrypto;
  readonly writer: PwaLibraryCoreFeedGenerationWriter;
}

export interface MaterializePwaLibraryCoreFeedGenerationResult {
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

function forEachOwnFeedItem(
  feedItems: Record<string, FeedItem>,
  visitor: (globalId: string, item: FeedItem) => void,
): void {
  for (const globalId in feedItems) {
    if (!Object.prototype.hasOwnProperty.call(feedItems, globalId)) continue;
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
    visitor(globalId, item);
  }
}

function snapshotCommittedSource(
  value: CommittedAutomergeFeedSource,
): Readonly<{
  heads: readonly string[];
  generation: number;
  saveRevision: number;
}> {
  const { generation, saveRevision } = value.revision;
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    !Number.isSafeInteger(saveRevision) ||
    saveRevision < 0 ||
    value.heads.length === 0 ||
    value.heads.length > MAXIMUM_AUTHENTICATED_HEADS
  ) {
    throw new TypeError("committed Automerge source identity is invalid");
  }
  const heads = [...value.heads];
  if (heads.some((head) => !LOWER_HEX_64.test(head))) {
    throw new TypeError("committed Automerge head identity is invalid");
  }
  heads.sort();
  if (heads.some((head, index) => index > 0 && heads[index - 1] === head)) {
    throw new TypeError("committed Automerge source repeats one head");
  }
  return Object.freeze({
    generation,
    heads: Object.freeze(heads),
    saveRevision,
  });
}

function lowerHex(bytes: ArrayBuffer): string {
  let output = "";
  for (const byte of new Uint8Array(bytes)) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

export async function derivePwaLibraryCoreFeedGenerationSource(
  committed: CommittedAutomergeFeedSource,
  subtle: SubtleCrypto,
  domain = SOURCE_DOMAIN,
  contract?: Readonly<Record<string, unknown>>,
): Promise<LibraryCoreFeedPageSourceV1> {
  const snapshot = snapshotCommittedSource(committed);
  const digestInput = TEXT_ENCODER.encode(
    JSON.stringify(
      contract
        ? {
            contract,
            domain,
            generation: snapshot.generation,
            heads: snapshot.heads,
            saveRevision: snapshot.saveRevision,
          }
        : {
            domain,
            generation: snapshot.generation,
            heads: snapshot.heads,
            saveRevision: snapshot.saveRevision,
          },
    ),
  );
  return Object.freeze({
    generationId: lowerHex(
      await subtle.digest("SHA-256", digestInput),
    ) as LibraryCoreFeedPageSourceV1["generationId"],
    projectionRevision: snapshot.saveRevision,
    transitionSequence: snapshot.generation,
  });
}

/**
 * Build one dormant row generation from the exact committed Automerge
 * frontier. Enumeration and projection hold at most one source item and one
 * 128-row output page in application memory.
 */
export async function materializePwaLibraryCoreFeedGeneration(
  input: MaterializePwaLibraryCoreFeedGenerationInput,
): Promise<MaterializePwaLibraryCoreFeedGenerationResult> {
  const source = await derivePwaLibraryCoreFeedGenerationSource(
    input.committed,
    input.subtle,
  );
  const feedItems = feedItemsOf(input.document);
  let totalCount = 0;
  forEachOwnFeedItem(feedItems, (_globalId, item) => {
    if (!isLibraryCoreVisibleFeedItemV1(item)) return;
    totalCount += 1;
    if (!Number.isSafeInteger(totalCount)) {
      throw new RangeError(
        "visible feed item count exceeds safe integer range",
      );
    }
  });

  const state = await input.writer.beginGeneration({ source, totalCount });
  if (state === "complete") {
    await input.writer.finalizeGeneration(source);
    return Object.freeze({ source, totalCount });
  }

  let batchIndex = 0;
  let rows: LibraryCoreFeedCardV1[] = [];
  const flush = async (): Promise<void> => {
    if (rows.length === 0) return;
    const page = Object.freeze(rows);
    rows = [];
    await input.writer.appendGenerationPage({
      batchIndex,
      rows: page,
      source,
    });
    batchIndex += 1;
  };

  for (const globalId in feedItems) {
    if (!Object.prototype.hasOwnProperty.call(feedItems, globalId)) continue;
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
    if (!isLibraryCoreVisibleFeedItemV1(item)) continue;
    rows.push(projectLibraryCoreFeedCardV1(item));
    if (rows.length === MATERIALIZATION_PAGE_ROWS) await flush();
  }
  await flush();
  await input.writer.finalizeGeneration(source);
  return Object.freeze({ source, totalCount });
}
