import { createLibraryCoreRecoveryPreferenceDraftV1, type RecoveryPreferenceDraft } from "@freed/shared/library-core";
import type { RecoveryReachOutDraft, RecoveryReachOutHistory } from "@freed/ui/components/RecoveryReachOutFields";
import { PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA } from "@freed/shared/library-core";
import type { Account } from "@freed/shared";
import type { RecoveryAccountDraft } from "@freed/ui/components/RecoveryAccountFields";
import { ACCOUNT_UPSERT_PAYLOAD_SCHEMA } from "@freed/shared/library-core";
import { readLibraryCoreRecoveryFriendDraftV1, type RecoveryFriendDraft } from "@freed/shared/library-core";
import type { RecoveryPersonDraft } from "@freed/ui/components/RecoveryPersonFields";
import { type Person } from "@freed/shared";
import { PERSON_UPSERT_PAYLOAD_SCHEMA, LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, type LibraryCoreCanonicalValue } from "@freed/shared/library-core";
import type { RecoveryAccountLinkDraft } from "@freed/ui/components/RecoveryAccountLinkFields";
import type { RssFeed } from "@freed/shared";
import {
  ACCOUNT_REMOVE_PAYLOAD_SCHEMA, ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_SCHEMA,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  RSS_FEED_UPSERT_PAYLOAD_SCHEMA,
  parseLibraryCoreRecoveryIntentReviewRequestV1,
  RSS_FEED_TITLE_ASSIGNMENT_PAYLOAD_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA,
  FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA,
  FEED_ITEM_REMOVE_PAYLOAD_SCHEMA,
  PERSON_REMOVE_AND_ACCOUNTS_PAYLOAD_SCHEMA,
  type FeedItemAnnotationsReplacePayloadV1,
  type LibraryCoreRecoveryIntentReviewResponseV1,
  type LibraryCoreRecoveryReissueReceiptV1,
} from "@freed/shared/library-core";
import { queryPwaNormalizedLibrary } from "./library-core-sqlite-runtime";

export interface PwaRecoveryRssTitleDraft {
  readonly url: string;
  readonly archivedTitle: string;
  readonly currentTitle: string;
  readonly title: string;
}

/** Visit one complete verified transaction without retaining transport pages. */
async function visitRecoveryMembers(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal: AbortSignal | undefined,
  visit: (row: LibraryCoreRecoveryIntentReviewResponseV1["rows"][number], envelope: Readonly<Record<string, unknown>>) => Promise<void>,
): Promise<LibraryCoreRecoveryReissueReceiptV1 | null> {
  let count = 0;
  let cursor: string | null = null, bytes = 0;
  const check = () => { if (signal?.aborted) throw new Error("Recovery editor closed."); };
  do {
    check();
    const request = parseLibraryCoreRecoveryIntentReviewRequestV1({ queryId: "recovery_intent_review_v1", schemaVersion: 1,
      recoveryId: review.recoveryId, transactionId: review.transactionId, includeOriginal: true, cursor, limit: 16,
      cancellationId: crypto.randomUUID(), readerSessionId: crypto.randomUUID() });
    if (!request.ok) throw new Error(request.error);
    const page = await queryPwaNormalizedLibrary(request.value);
    check();
    if (page.archiveDigest !== review.archiveDigest || page.transactionDigest !== review.transactionDigest || page.memberCount !== review.memberCount)
      throw new Error("Recovery identity changed.");
    if (page.replacement) return page.replacement;
    if (page.outcome.state === "confirmed_accepted") throw new Error("This edit was already accepted.");
    if (page.source.generationId !== review.source.generationId || page.source.projectionRevision !== review.source.projectionRevision ||
        page.source.transitionSequence !== review.source.transitionSequence) throw new Error("The Library changed. Verify this edit again.");
    for (const row of page.rows) {
      check();
      if (row.memberIndex !== count || row.originalEnvelopeJson === null)
        throw new Error("This transaction needs another editor. No members were removed.");
      const encoded = new TextEncoder().encode(row.originalEnvelopeJson);
      bytes += encoded.length;
      if (bytes > 4194304 || count >= 1000) throw new Error("Recovery transaction exceeds its bounds.");
      const envelope = decodeLibraryCoreCanonicalValue(Uint8Array.from(encoded)) as Readonly<Record<string, unknown>>;
      await visit(row, envelope);
      check(); count += 1;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  if (count !== review.memberCount) throw new Error("The preserved transaction is incomplete.");
  return null;
}

/** No feed URL requests: current names come from local SQLite. */
export async function loadPwaRecoveryRssTitleDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly PwaRecoveryRssTitleDraft[] }
> {
  const drafts: PwaRecoveryRssTitleDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
      if (row.operationType !== "rss_feed_title_assignment") throw new Error("This transaction needs another editor. No members were removed.");
      const payload = RSS_FEED_TITLE_ASSIGNMENT_PAYLOAD_SCHEMA.validate(envelope.payload);
      if (!payload.ok || envelope.entity_type !== "RssFeed" || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
        throw new Error("Archived feed name is invalid.");
      const current = await queryPwaNormalizedLibrary({ queryId: "rss_feed_detail_v1", schemaVersion: 1, url: row.entityId });
      if (signal?.aborted) throw new Error("Recovery editor closed.");
      if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
        throw new Error("The Library changed. Verify this edit again.");
      if (!current.feed) throw new Error("A feed no longer exists. Its archived edit is preserved.");
      drafts.push({ url: row.entityId, archivedTitle: payload.value.title, currentTitle: current.feed.title, title: payload.value.title });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

export interface PwaRecoveryAnnotationDraft {
  readonly entityId: string;
  readonly label: string;
  readonly highlights: FeedItemAnnotationsReplacePayloadV1["highlights"];
  readonly tags: readonly string[];
}

/** Preserve complete annotation payloads, including unloaded quote references. */
export async function loadPwaRecoveryAnnotationDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly PwaRecoveryAnnotationDraft[] }
> {
  const drafts: PwaRecoveryAnnotationDraft[] = [];
  let bytes = 0;
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "feed_item_annotations_replace" || envelope.entity_type !== "FeedItem" || row.itemPresent !== true)
      throw new Error("The complete transaction needs available items and the annotation editor.");
    const payload = FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (!payload.ok || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("The original annotation set cannot be preserved by this editor.");
    const draft = { entityId: row.entityId, label: row.itemText?.slice(0, 240) || `Item ...${row.entityId.slice(-8)}`,
      highlights: payload.value.highlights, tags: payload.value.tags };
    bytes += new TextEncoder().encode(JSON.stringify(draft)).length;
    if (bytes > 4194304) throw new Error("The complete annotation draft exceeds its bounds.");
    drafts.push(draft);
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

export interface PwaRecoveryRssRemovalDraft {
  readonly url: string;
  readonly title: string;
  readonly includeItems: boolean;
}

/** Preserve unsubscribe scope; with-items cannot silently become keep-items. */
export async function loadPwaRecoveryRssRemovalDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly PwaRecoveryRssRemovalDraft[] }
> {
  const drafts: PwaRecoveryRssRemovalDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    if (!["rss_feed_remove_keep_items", "rss_feed_remove_with_items"].includes(row.operationType) || envelope.entity_type !== "RssFeed" ||
        !RSS_FEED_REMOVE_KEEP_ITEMS_PAYLOAD_SCHEMA.validate(envelope.payload).ok || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No members were removed.");
    const includeItems = row.operationType === "rss_feed_remove_with_items";
    if (drafts.length && drafts[0]!.includeItems !== includeItems) throw new Error("Mixed unsubscribe scopes need a different editor.");
    const current = await queryPwaNormalizedLibrary({ queryId: "rss_feed_detail_v1", schemaVersion: 1, url: row.entityId });
    if (signal?.aborted) throw new Error("Recovery editor closed.");
    if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("The Library changed. Verify this edit again.");
    if (!current.feed) throw new Error("A subscription is already absent. That does not prove the original edit was accepted; its archive is preserved.");
    drafts.push({ url: row.entityId, title: current.feed.title, includeItems });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

export interface PwaRecoveryItemRemovalDraft {
  readonly entityId: string;
  readonly label: string;
  readonly present: boolean;
}

/** Preserve every original target; absence is not evidence of acceptance. */
export async function loadPwaRecoveryItemRemovalDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly PwaRecoveryItemRemovalDraft[] }
> {
  const drafts: PwaRecoveryItemRemovalDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "feed_item_remove" || envelope.entity_type !== "FeedItem" || typeof row.itemPresent !== "boolean" ||
        !FEED_ITEM_REMOVE_PAYLOAD_SCHEMA.validate(envelope.payload).ok || !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No targets were removed.");
    drafts.push({ entityId: row.entityId, label: row.itemText?.slice(0, 240) || `Item ...${row.entityId.slice(-8)}`, present: row.itemPresent });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

export interface PwaRecoveryRssUpsertDraft {
  readonly archived: RssFeed;
  readonly current: RssFeed | null;
  readonly feed: RssFeed;
}

/** Existing subscriptions only: an upsert cannot revive a tombstoned URL. */
export async function loadPwaRecoveryRssUpsertDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal,
): Promise<{ replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly PwaRecoveryRssUpsertDraft[] }> {
  const drafts: PwaRecoveryRssUpsertDraft[] = [];
  let currentBytes = 0;
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    const payload = RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "rss_feed_upsert" || envelope.entity_type !== "RssFeed" || !payload.ok ||
        !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0 || payload.value.feed.url !== row.entityId)
      throw new Error("This transaction needs a different editor. No members were removed.");
    const response = await queryPwaNormalizedLibrary({ queryId: "rss_feed_detail_v1", schemaVersion: 1, url: row.entityId });
    if (signal?.aborted) throw new Error("Recovery editor closed.");
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

/** Read fixed ordered targets without retaining complete account/person records. */
export async function loadPwaRecoveryAccountLinkDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal):
Promise<{ replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly RecoveryAccountLinkDraft[] }> {
  const drafts: RecoveryAccountLinkDraft[] = [];
  const check = (source: { generationId: string; projectionRevision: number }) => {
    if (signal?.aborted) throw new Error("Recovery editor closed.");
    if (source.generationId !== review.source.generationId || source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
  };
  const person = async (id: string | null) => {
    if (id === null) return { id, label: "Unlinked", present: true };
    const response = await queryPwaNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId: id });
    check(response.source);
    return { id, label: response.person?.name.slice(0, 240) || "Person (absent)", present: response.person !== null };
  };
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    const payload = ACCOUNT_PERSON_ASSIGNMENT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "account_person_assignment" || envelope.entity_type !== "Account" || !payload.ok ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0) throw new Error("This transaction needs a different editor. No members were removed.");
    const response = await queryPwaNormalizedLibrary({ queryId: "account_detail_v1", schemaVersion: 1, accountId: row.entityId });
    check(response.source);
    const account = response.account;
    if (!account || account.id !== row.entityId) throw new Error("An account is no longer present. Its entire archived edit is preserved.");
    const current = await person(account.personId);
    const archived = await person(payload.value.person_id);
    drafts.push({ accountId: row.entityId, label: (account.displayName || account.handle || account.externalId).slice(0, 240), current, archived });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

/** Person deletion retains its original targets and resolves current labels only. */
export async function loadPwaRecoveryPersonRemovalDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal,
): Promise<{ replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly PwaRecoveryItemRemovalDraft[] }> {
  const drafts: PwaRecoveryItemRemovalDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "person_remove_and_accounts" || envelope.entity_type !== "Person" ||
      !PERSON_REMOVE_AND_ACCOUNTS_PAYLOAD_SCHEMA.validate(envelope.payload).ok ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No targets were removed.");
    const current = await queryPwaNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId: row.entityId });
    if (signal?.aborted) throw new Error("QUERY_CANCELLED");
    if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("CURSOR_STALE");
    if (current.person && current.person.id !== row.entityId) throw new Error("Person identity changed");
    drafts.push({ entityId: row.entityId, label: current.person?.name.slice(0, 240) || "Person (absent)", present: current.person !== null });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

/** Preserve the complete ordered Account deletion and source-pinned labels. */
export async function loadPwaRecoveryAccountRemovalDrafts(
  review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal,
): Promise<{ replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly PwaRecoveryItemRemovalDraft[] }> {
  const drafts: PwaRecoveryItemRemovalDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    if (row.operationType !== "account_remove" || envelope.entity_type !== "Account" ||
      !ACCOUNT_REMOVE_PAYLOAD_SCHEMA.validate(envelope.payload).ok ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs another editor. No targets were removed.");
    const current = await queryPwaNormalizedLibrary({ queryId: "account_detail_v1", schemaVersion: 1, accountId: row.entityId });
    if (signal?.aborted) throw new Error("QUERY_CANCELLED");
    if (current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("CURSOR_STALE");
    if (current.account && current.account.id !== row.entityId) throw new Error("Account identity changed");
    drafts.push({ entityId: row.entityId, label: (current.account?.displayName || current.account?.handle || current.account?.externalId)?.slice(0, 240) || "Account (absent)", present: current.account !== null });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

const rootKeys = new Set(["id", "name", "avatarUrl", "bio", "relationshipStatus", "careLevel", "reachOutIntervalDays", "tags", "notes", "sampleDataFingerprint", "createdAt", "updatedAt"]);

/** Keep whole verified roots within a fixed retained-byte budget; never read the Person catalog. */
export async function loadPwaRecoveryPersonDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly RecoveryPersonDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_upsert.maximumMembers) throw new Error("Person recovery exceeds its member bound");
  let retainedBytes = 0;
  const drafts: RecoveryPersonDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    const payload = PERSON_UPSERT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "person_upsert" || envelope.entity_type !== "Person" || !payload.ok ||
      payload.value.person.id !== row.entityId || Object.keys(payload.value.person).some(key => !rootKeys.has(key)) ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs a different editor. No members were removed.");
    if (row.personState === "deleted") throw new Error("A person in this edit was deleted. Recovery cannot recreate them.");
    if (row.personState !== "present" && row.personState !== "absent") throw new Error("Person recovery state is unavailable");
    const response = await queryPwaNormalizedLibrary({ queryId: "person_root_v1", schemaVersion: 1, personId: row.entityId });
    if (signal?.aborted) throw new Error("QUERY_CANCELLED");
    if (response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision ||
      (response.person !== null) !== (row.personState === "present") || response.person && response.person.id !== row.entityId) throw new Error("CURSOR_STALE");
    const archived = payload.value.person as unknown as Person;
    const current = response.person ? response.person as unknown as Person : null;
    const person = { ...(current ?? archived) };
    // Recreating an absent record must not silently restore remote image loading.
    if (!current) delete person.avatarUrl;
    for (const value of [archived, current]) if (value) retainedBytes += encodeLibraryCoreCanonicalValue(value as unknown as LibraryCoreCanonicalValue).length;
    if (retainedBytes > 4194304) throw new Error("Person recovery exceeds its retained detail budget");
    drafts.push({ archived, current, person });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

/** Use the same bounded current-context rules as Desktop after browser archive verification. */
export async function loadPwaRecoveryFriendDraft(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; draft?: never } | { replacement: null; draft: RecoveryFriendDraft }
> {
  if (review.memberCount !== 1) throw new Error("Friend recovery requires its complete single-member transaction");
  let draft: RecoveryFriendDraft | undefined;
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    draft = await readLibraryCoreRecoveryFriendDraftV1(review, row, envelope, queryPwaNormalizedLibrary,
      () => { if (signal?.aborted) throw new Error("QUERY_CANCELLED"); });
  });
  if (replacement) return { replacement };
  if (!draft) throw new Error("Friend recovery is incomplete");
  return { replacement: null, draft };
}

/** At most the registered member count of complete 64 KiB roots; no catalog read. */
export async function loadPwaRecoveryAccountDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly RecoveryAccountDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_upsert.maximumMembers) throw new Error("Account recovery exceeds its member bound");

  const drafts: RecoveryAccountDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    const payload = ACCOUNT_UPSERT_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "account_upsert" || envelope.entity_type !== "Account" || !payload.ok ||
      payload.value.account.id !== row.entityId ||
      !Array.isArray(envelope.blob_references) || envelope.blob_references.length !== 0)
      throw new Error("This transaction needs a different editor. No members were removed.");
    const response = await queryPwaNormalizedLibrary({ queryId: "account_root_v1", schemaVersion: 1, accountId: row.entityId });
    if (signal?.aborted) throw new Error("QUERY_CANCELLED");
    if (response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision ||
      response.account && response.account.id !== row.entityId) throw new Error("CURSOR_STALE");
    const archived = payload.value.account as unknown as Account;
    const current = response.account ? response.account as unknown as Account : null;
    const account = { ...(current ?? archived) };
    // Recreating an absent record must not silently restore remote image loading.
    if (!current) delete account.avatarUrl;
    drafts.push({ archived, current, account });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

export async function readPwaRecoveryReachOutHistory(review: LibraryCoreRecoveryIntentReviewResponseV1, personId: string, signal?: AbortSignal): Promise<RecoveryReachOutHistory> {
  const response = await queryPwaNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId });
  if (signal?.aborted) throw new Error("QUERY_CANCELLED");
  if (!response.person || response.person.id !== personId || response.source.generationId !== review.source.generationId || response.source.projectionRevision !== review.source.projectionRevision) throw new Error("CURSOR_STALE");
  return { name: response.person.name, events: response.person.reachOuts };
}

/** Retain only original event payloads, not a history window for every Person. */
export async function loadPwaRecoveryReachOutDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly RecoveryReachOutDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_reach_out_append.maximumMembers) throw new Error("Recovery exceeds its member bound");
  const drafts: RecoveryReachOutDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    const payload = PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA.validate(envelope.payload);
    if (row.operationType !== "person_reach_out_append" || envelope.entity_type !== "Person" || !payload.ok || typeof envelope.operation_id !== "string" || !Array.isArray(envelope.blob_references) || envelope.blob_references.length)
      throw new Error("This transaction needs another editor. No members were removed.");
    // Read and discard each bounded current history, retaining only event drafts.
    const history = await readPwaRecoveryReachOutHistory(review, row.entityId, signal);
    if (history.events.some(event => event.reachOutId === envelope.operation_id)) throw new Error("The original event is already present");
    drafts.push({ personId: row.entityId, originalOperationId: envelope.operation_id, archived: payload.value, event: payload.value });
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}

/** Verify complete original members before the form requests selected comparisons. */
export async function loadPwaRecoveryPreferenceDrafts(review: LibraryCoreRecoveryIntentReviewResponseV1, signal?: AbortSignal): Promise<
  { replacement: LibraryCoreRecoveryReissueReceiptV1; drafts?: never } | { replacement: null; drafts: readonly RecoveryPreferenceDraft[] }
> {
  if (review.memberCount > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.preferences_leaf_assignment.maximumMembers) throw new Error("Recovery exceeds its member bound");
  const drafts: RecoveryPreferenceDraft[] = [];
  const replacement = await visitRecoveryMembers(review, signal, async (row, envelope) => {
    drafts.push(createLibraryCoreRecoveryPreferenceDraftV1(row, envelope, () => { if (signal?.aborted) throw new Error("QUERY_CANCELLED"); }));
  });
  return replacement ? { replacement } : { replacement: null, drafts };
}
