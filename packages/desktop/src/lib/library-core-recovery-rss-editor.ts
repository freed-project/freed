import type { RssFeed } from "@freed/shared";
import { visitRecoveryEditorMembers } from "./library-core-recovery-editor-input";
import {
  RSS_FEED_TITLE_ASSIGNMENT_PAYLOAD_SCHEMA,
  RSS_FEED_UPSERT_PAYLOAD_SCHEMA,
  encodeLibraryCoreCanonicalValue,
  RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA,
  type LibraryCoreRecoveryIntentReviewResponseV1,
} from "@freed/shared/library-core";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import type { RecoveryReissueReceipt } from "./library-core-recovery-reissue";

export interface RecoveryRssTitleDraft {
  readonly url: string;
  readonly archivedTitle: string;
  readonly currentTitle: string;
  readonly title: string;
}
export type RecoveryRssEditorLoad =
  | { readonly replacement: RecoveryReissueReceipt; readonly drafts?: never }
  | { readonly replacement: null; readonly drafts: readonly RecoveryRssTitleDraft[] };

/** One signed transaction, bounded to 4 MiB, with no URL or provider fetches. */
export async function loadRecoveryRssTitleDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1,
  signal: AbortSignal,
): Promise<RecoveryRssEditorLoad> {
  const drafts: RecoveryRssTitleDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
      if (row.operationType !== "rss_feed_title_assignment") throw new Error("This transaction needs a different editor; no members were removed");
      const payload = RSS_FEED_TITLE_ASSIGNMENT_PAYLOAD_SCHEMA.validate(envelope.payload);
      if (!payload.ok || envelope.entity_type !== "RssFeed" || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
        throw new Error("Archived feed name is invalid");
      const current = await queryNormalizedLibrary({ queryId: "rss_feed_detail_v1", schemaVersion: 1, url: row.entityId }, signal);
      if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
        throw new Error("CURSOR_STALE");
      if (!current.feed) throw new Error("A feed no longer exists. Its archived edit is preserved");
      drafts.push({ url: row.entityId, archivedTitle: payload.value.title, title: payload.value.title, currentTitle: current.feed.title });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

export interface RecoveryRssRemovalDraft {
  readonly url: string;
  readonly title: string;
  readonly includeItems: boolean;
}

/** Preserve the original unsubscribe scope and ordered targets without contacting feeds. */
export async function loadRecoveryRssRemovalDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal,
): Promise<{ replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryRssRemovalDraft[] }> {
  const drafts: RecoveryRssRemovalDraft[] = [];
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    if (!["rss_feed_remove_keep_items", "rss_feed_remove_with_items"].includes(row.operationType) || envelope.entity_type !== "RssFeed" ||
        !RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA.validate(envelope.payload).ok || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No members were removed.");
    const includeItems = row.operationType === "rss_feed_remove_with_items";
    if (drafts.length && drafts[0]!.includeItems !== includeItems) throw new Error("Mixed unsubscribe scopes need a different editor.");
    const current = await queryNormalizedLibrary({ queryId: "rss_feed_detail_v1", schemaVersion: 1, url: row.entityId }, signal);
    if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("CURSOR_STALE");
    if (!current.feed) throw new Error("A subscription is already absent. That does not prove the original edit was accepted; its archive is preserved.");
    drafts.push({ url: row.entityId, title: current.feed.title, includeItems });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}


export interface RecoveryRssUpsertDraft {
  readonly archived: RssFeed;
  readonly current: RssFeed | null;
  readonly feed: RssFeed;
}

/** Existing subscriptions only: an upsert cannot revive a tombstoned URL. */
export async function loadRecoveryRssUpsertDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal,
): Promise<{ replacement: RecoveryReissueReceipt; drafts?: never } | { replacement: null; drafts: readonly RecoveryRssUpsertDraft[] }> {
  const drafts: RecoveryRssUpsertDraft[] = [];
  let currentBytes = 0;
  const replacement = await visitRecoveryEditorMembers(review, signal, async (row, envelope) => {
    const payload = RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "rss_feed_upsert" || envelope.entity_type !== "RssFeed" || !payload.ok ||
        !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0 || payload.value.feed.url !== row.entityId)
      throw new Error("This transaction needs a different editor. No members were removed.");
    const response = await queryNormalizedLibrary({ queryId: "rss_feed_detail_v1", schemaVersion: 1, url: row.entityId }, signal);
    if (response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("CURSOR_STALE");
    const rowFeed = response.feed;
    if (row.rssFeedState === "deleted") throw new Error("This subscription was deleted. Recovery cannot restore it with an upsert.");
    if (!rowFeed && row.rssFeedState === "absent") {
      const archived = payload.value.feed as unknown as RssFeed;
      // An old fetch timestamp is not evidence of a fetch in the current Library.
      const feed: RssFeed = { url: archived.url, title: archived.title, enabled: false, trackUnread: archived.trackUnread,
        ...(archived.sampleDataFingerprint === undefined ? {} : { sampleDataFingerprint: archived.sampleDataFingerprint }) };
      drafts.push({ archived, current: null, feed });
      return;
    }

    if (!rowFeed) throw new Error("This subscription is absent. An archived upsert cannot restore a deleted feed.");
    if (rowFeed.url !== row.entityId) throw new Error("Current subscription identity changed");
    const current: RssFeed = {
      url: rowFeed.url, title: rowFeed.title, enabled: rowFeed.enabled, trackUnread: rowFeed.trackUnread,
      ...(rowFeed.siteUrl === null ? {} : { siteUrl: rowFeed.siteUrl }),
      ...(rowFeed.imageUrl === null ? {} : { imageUrl: rowFeed.imageUrl }),
      ...(rowFeed.folder === null ? {} : { folder: rowFeed.folder }),
      ...(rowFeed.pollInterval === null ? {} : { pollInterval: rowFeed.pollInterval }),
      ...(rowFeed.lastFetched === null ? {} : { lastFetched: rowFeed.lastFetched }),
      ...(rowFeed.sampleBatchId === null ? {} : { sampleDataFingerprint: {
        marker: "freed.sample-data.v1" as const, batchId: rowFeed.sampleBatchId,
        generatedAt: rowFeed.sampleGeneratedAt!, generatorVersion: rowFeed.sampleGeneratorVersion!,
      } }),
    };
    if (!RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate({ feed: current }).ok) throw new Error("Current subscription is invalid");
    currentBytes += encodeLibraryCoreCanonicalValue({ feed: current } as unknown as Parameters<typeof encodeLibraryCoreCanonicalValue>[0]).length;
    if (currentBytes > 4194304) throw new Error("Current subscription review exceeds its bounds");
    drafts.push({ archived: payload.value.feed as unknown as RssFeed, current, feed: { ...current } });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
