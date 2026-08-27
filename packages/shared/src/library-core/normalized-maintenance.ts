import { hasSampleDataFingerprint } from "../sample-data.js";
import type { Account } from "../types.js";
import {
  scanLibraryCoreAccountRowsV1,
  scanLibraryCoreNormalizedBackgroundItemsV1,
  scanLibraryCorePersonRowsV1,
  scanLibraryCoreRssFeedsV1,
  type LibraryCoreNormalizedReaderRuntime,
} from "./normalized-feed-readers.js";
import {
  readLibraryCoreNormalizedAccountDetailV1,
  readLibraryCoreNormalizedPersonDetailV1,
} from "./normalized-surface-readers.js";

export interface LibraryCoreSampleRemovalPlanV1 {
  readonly feedUrls: readonly string[];
  readonly itemIds: readonly string[];
  readonly personIds: readonly string[];
  readonly realLinkedAccounts: readonly Account[];
  readonly sampleAccountIds: readonly string[];
}

/**
 * Resolve only the normalized rows required to remove one sample library.
 * Source-fenced SQLite pages remain outside React, and retained collections
 * contain mutation targets only rather than a Library projection.
 */
export async function collectLibraryCoreSampleRemovalPlanV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
): Promise<LibraryCoreSampleRemovalPlanV1> {
  const feedUrls: string[] = [];
  await scanLibraryCoreRssFeedsV1(runtime, (feeds) => {
    for (const feed of feeds) {
      if (hasSampleDataFingerprint(feed)) feedUrls.push(feed.url);
    }
    return "continue" as const;
  });

  const personIds = new Set<string>();
  await scanLibraryCorePersonRowsV1(runtime, async (rows) => {
    for (const row of rows) {
      const person = await readLibraryCoreNormalizedPersonDetailV1(
        runtime,
        row.id,
      );
      if (person && hasSampleDataFingerprint(person)) personIds.add(person.id);
    }
    return "continue" as const;
  });

  const sampleAccountIds: string[] = [];
  const realLinkedAccounts: Account[] = [];
  await scanLibraryCoreAccountRowsV1(runtime, async (rows) => {
    for (const row of rows) {
      const account = await readLibraryCoreNormalizedAccountDetailV1(
        runtime,
        row.id,
      );
      if (!account) continue;
      if (hasSampleDataFingerprint(account)) {
        sampleAccountIds.push(account.id);
      } else if (
        account.personId !== undefined &&
        personIds.has(account.personId)
      ) {
        realLinkedAccounts.push(account);
      }
    }
    return "continue" as const;
  });

  const itemIds: string[] = [];
  await scanLibraryCoreNormalizedBackgroundItemsV1(runtime, (items) => {
    for (const item of items) {
      if (hasSampleDataFingerprint(item)) itemIds.push(item.globalId);
    }
    return "continue";
  });

  return {
    feedUrls,
    itemIds,
    personIds: [...personIds],
    realLinkedAccounts,
    sampleAccountIds,
  };
}
