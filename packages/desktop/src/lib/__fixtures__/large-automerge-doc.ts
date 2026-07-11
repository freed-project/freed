import * as A from "@automerge/automerge";
import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import { addFeedItem, type FreedDoc } from "@freed/shared/schema";
import { createPersistenceState, persistDoc } from "../automerge-persistence";

const MEBIBYTE = 1024 * 1024;
const FIXTURE_ACTOR_ID = "01".repeat(16);
const FIXTURE_EPOCH_MS = Date.UTC(2025, 0, 1);
const FIXTURE_LOCALE = "en-US";
const DEFAULT_TARGET_BYTES = 6 * MEBIBYTE;
const DEFAULT_MINIMUM_HISTORY_DEPTH = 64;
const DEFAULT_BATCH_SIZE = 96;
const DEFAULT_MAX_ITEMS = 4_096;
const CONTENT_TEXT_BYTES = 4_000;
const PRESERVED_TEXT_BYTES = 3_000;
const LINK_DESCRIPTION_BYTES = 180;
const TEXT_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export interface LargeAutomergeFixtureOptions {
  targetBytes?: number;
  minimumHistoryDepth?: number;
  batchSize?: number;
  maxItems?: number;
  seed?: number;
}

export interface LargeAutomergeFixtureManifest {
  schemaVersion: 1;
  seed: number;
  targetBytes: number;
  binaryBytes: number;
  itemCount: number;
  historyDepth: number;
  incrementalMutationCount: number;
  incrementalWriteCount: number;
  snapshotWriteCount: number;
  expectedItemIds: string[];
  mutationTargetId: string;
  contentTextBytes: number;
  preservedTextBytes: number;
}

export interface LargeAutomergeFixture {
  binary: Uint8Array;
  manifest: LargeAutomergeFixtureManifest;
}

function requireInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum.toLocaleString()} to ${maximum.toLocaleString()}.`,
    );
  }
  return value;
}

function fixtureItemId(index: number): string {
  return `saved:automerge-fixture:${index.toString().padStart(5, "0")}`;
}

function formatFixtureNumber(value: number): string {
  return value.toLocaleString(FIXTURE_LOCALE);
}

function seededText(seed: number, length: number): string {
  let state = seed >>> 0;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    value += TEXT_ALPHABET[state % TEXT_ALPHABET.length];
  }
  return value;
}

function createFixtureItem(index: number, seed: number): FeedItem {
  const globalId = fixtureItemId(index);
  const sourceUrl = `https://fixture.freed.test/articles/${index.toString()}`;
  const publishedAt = FIXTURE_EPOCH_MS + index * 60_000;
  const itemSeed = seed + index * 97;

  return {
    globalId,
    platform: "saved",
    contentType: "article",
    capturedAt: publishedAt,
    publishedAt,
    sourceUrl,
    author: {
      id: `fixture-author-${(index % 32).toString()}`,
      handle: `fixture-author-${(index % 32).toString()}`,
      displayName: `Fixture Author ${formatFixtureNumber(index % 32)}`,
    },
    content: {
      text: seededText(itemSeed, CONTENT_TEXT_BYTES),
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: {
        url: sourceUrl,
        title: `Automerge fixture article ${formatFixtureNumber(index)}`,
        description: seededText(itemSeed + 10_000, LINK_DESCRIPTION_BYTES),
      },
    },
    preservedContent: {
      text: seededText(itemSeed + 20_000, PRESERVED_TEXT_BYTES),
      wordCount: 600,
      readingTime: 3,
      preservedAt: publishedAt,
    },
    contentSignals: {
      version: 3,
      method: "rules",
      inferredAt: publishedAt,
      scores: {},
      tags: [],
    },
    userState: {
      hidden: false,
      saved: true,
      savedAt: publishedAt,
      archived: false,
      tags: [],
    },
    topics: [],
  };
}

function createDeterministicDoc(): FreedDoc {
  return A.change(
    A.init<FreedDoc>({ actor: FIXTURE_ACTOR_ID }),
    { message: "Initialize deterministic Automerge fixture", time: 0 },
    (draft) => {
      draft.feedItems = {};
      draft.rssFeeds = {};
      draft.persons = {};
      draft.accounts = {};
      draft.preferences = createDefaultPreferences();
      draft.meta = {
        deviceId: "automerge-memory-fixture",
        lastSync: 0,
        version: 1,
      };
    },
  );
}

export function createLargeAutomergeFixture(
  options: LargeAutomergeFixtureOptions = {},
): LargeAutomergeFixture {
  const targetBytes = requireInteger(
    options.targetBytes ?? DEFAULT_TARGET_BYTES,
    "targetBytes",
    64 * 1024,
    16 * MEBIBYTE,
  );
  const minimumHistoryDepth = requireInteger(
    options.minimumHistoryDepth ?? DEFAULT_MINIMUM_HISTORY_DEPTH,
    "minimumHistoryDepth",
    2,
    256,
  );
  const batchSize = requireInteger(
    options.batchSize ?? DEFAULT_BATCH_SIZE,
    "batchSize",
    1,
    512,
  );
  const maxItems = requireInteger(
    options.maxItems ?? DEFAULT_MAX_ITEMS,
    "maxItems",
    batchSize,
    10_000,
  );
  const seed = requireInteger(
    options.seed ?? 0x5eedc0de,
    "seed",
    0,
    0xffff_ffff,
  );

  let doc = createDeterministicDoc();
  let binary = A.save(doc);
  let itemCount = 0;

  while (binary.byteLength < targetBytes && itemCount < maxItems) {
    const batchStart = itemCount;
    const nextItemCount = Math.min(itemCount + batchSize, maxItems);
    doc = A.change(
      doc,
      {
        message: `Add fixture items ${formatFixtureNumber(batchStart)} to ${formatFixtureNumber(nextItemCount - 1)}`,
        time: batchStart + 1,
      },
      (draft) => {
        for (let index = batchStart; index < nextItemCount; index += 1) {
          addFeedItem(draft, createFixtureItem(index, seed));
        }
      },
    );
    itemCount = nextItemCount;
    binary = A.save(doc);
  }

  if (binary.byteLength < targetBytes) {
    throw new Error(
      `Fixture reached ${binary.byteLength.toLocaleString()} bytes after ${itemCount.toLocaleString()} items, below target ${targetBytes.toLocaleString()} bytes.`,
    );
  }

  let persistence = createPersistenceState(binary);
  let historyDepth = A.getHistory(doc).length;
  let incrementalMutationCount = 0;
  let incrementalWriteCount = 0;
  let snapshotWriteCount = 0;

  while (historyDepth < minimumHistoryDepth) {
    const itemIndex = incrementalMutationCount % itemCount;
    const targetId = fixtureItemId(itemIndex);
    const mutationIndex = incrementalMutationCount;
    doc = A.change(
      doc,
      {
        message: `Fixture history mutation ${formatFixtureNumber(mutationIndex)}`,
        time: 1_000_000 + mutationIndex,
      },
      (draft) => {
        const item = draft.feedItems[targetId];
        if (!item) throw new Error(`Fixture item missing: ${targetId}`);
        item.userState.readAt = FIXTURE_EPOCH_MS + mutationIndex + 1;
      },
    );
    const persisted = persistDoc(doc, persistence);
    persistence = persisted.persistence;
    binary = persisted.binary;
    incrementalMutationCount += 1;
    if (persisted.usedIncremental) {
      incrementalWriteCount += 1;
    } else {
      snapshotWriteCount += 1;
    }
    historyDepth += 1;
  }

  const expectedItemIds = [
    fixtureItemId(0),
    fixtureItemId(Math.floor(itemCount / 2)),
    fixtureItemId(itemCount - 1),
  ];

  return {
    binary,
    manifest: {
      schemaVersion: 1,
      seed,
      targetBytes,
      binaryBytes: binary.byteLength,
      itemCount,
      historyDepth,
      incrementalMutationCount,
      incrementalWriteCount,
      snapshotWriteCount,
      expectedItemIds,
      mutationTargetId: fixtureItemId(itemCount - 1),
      contentTextBytes: CONTENT_TEXT_BYTES,
      preservedTextBytes: PRESERVED_TEXT_BYTES,
    },
  };
}
