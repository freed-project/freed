import { snapshotLibraryCoreRecoveryPreferencePatchesV1, sameLibraryCoreRecoveryPreferenceScopeV1 } from "@freed/shared/library-core";
import type { RecoveryReachOutDraft } from "@freed/ui/components/RecoveryReachOutFields";
import { PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA } from "@freed/shared/library-core";
import { loadPwaRecoveryPreferenceDrafts, loadPwaRecoveryReachOutDrafts, loadPwaRecoveryAccountDrafts, loadPwaRecoveryAccountRemovalDrafts, loadPwaRecoveryFriendDraft, loadPwaRecoveryPersonDrafts, loadPwaRecoveryPersonRemovalDrafts, loadPwaRecoveryAccountLinkDrafts, loadPwaRecoveryRssUpsertDrafts, loadPwaRecoveryItemRemovalDrafts, loadPwaRecoveryRssRemovalDrafts, loadPwaRecoveryAnnotationDrafts, loadPwaRecoveryRssTitleDrafts } from "./library-core-pwa-recovery-editors";
import { readPwaConsumerRecoveryStatus } from "./library-core-sqlite-runtime";
import {
  canonicalizeFeedItemTagsV1,
  ACCOUNT_PERSON_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  assembleLibraryCoreTransactionV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ANALYSIS_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  FRIEND_REPLACE_MAXIMUM_ACCOUNTS,
  FRIEND_REPLACE_PAYLOAD_SCHEMA,
  FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  compareLibraryCoreUtf8V1,
  encodeLibraryCoreFractionalNumbersV1,
  ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_UPSERT_PAYLOAD_SCHEMA, ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA,
  PERSON_UPSERT_PAYLOAD_SCHEMA,
  PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_PAYLOAD_SCHEMA,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
  finalizeLibraryCoreTransactionV1,
  sha256LowerHex,
  type FeedItemCaptureUpsertTransactionMemberInputV1,
  type FeedItemAnalysisReplacePayloadV1,
  type FeedItemAnalysisReplaceTransactionMemberInputV1,
  type FeedItemAnnotationsReplaceTransactionMemberInputV1,
  type FeedItemAnnotationsReplacePayloadV1,
  type AccountPersonAssignmentTransactionMemberInputV1,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type FeedItemRemoveTransactionMemberInputV1,
  type FeedItemUserStateAssignmentFieldV1,
  type FeedItemUserStateAssignmentTransactionMemberInputV1,
  type FriendReplaceTransactionMemberInputV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  type LibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreRecoveryIntentReviewResponseV1,
  type LibraryCoreRecoveryReissueReceiptV1,
  type LibraryCoreReapplyConsumerIntentV1,
  parseLibraryCoreRecoveryIntentReviewRequestV1,
  parseLibraryCoreReapplyConsumerIntentV1,
  type LibraryCoreFollowerMutationContextV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
  type PersonReachOutAppendTransactionMemberInputV1,
} from "@freed/shared/library-core";
import type {
  Account,
  FeedItem,
  Person,
  ReachOutLog,
  RssFeed,
  UserPreferences,
} from "@freed/shared";
import { signPwaLibraryCoreFollowerOperation } from "./library-core-browser-key-vault";
import { isPwaLibraryCoreSqliteWorkerUnavailableError } from "./library-core-sqlite-client";
import {
  commitPwaFollowerIntent,
  queryPwaNormalizedLibrary,
  reapplyPwaConsumerIntent,
  readPwaFollowerMutationContext,
} from "./library-core-sqlite-runtime";

const MAXIMUM_ASSIGNMENT_MEMBERS = 1_000;
export const PWA_LIBRARY_CORE_SQLITE_CAPTURE_BATCH_LIMIT =
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_capture_upsert.maximumMembers;
export const PWA_LIBRARY_CORE_SQLITE_ANALYSIS_BATCH_LIMIT =
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_analysis_replace.maximumMembers;
export const PWA_LIBRARY_CORE_SQLITE_ANNOTATION_BATCH_LIMIT =
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_annotations_replace.maximumMembers;
export const PWA_LIBRARY_CORE_SQLITE_RSS_FEED_BATCH_LIMIT =
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.rss_feed_upsert.maximumMembers;
export const PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT = Math.min(
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_upsert.maximumMembers,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_upsert.maximumMembers,
);
export const PWA_LIBRARY_CORE_SQLITE_REMOVE_BATCH_LIMIT = Math.min(
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_remove.maximumMembers,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_remove_and_accounts.maximumMembers,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_remove.maximumMembers,
);

function digest(
  domain: LibraryCoreDigestDomain,
  value: unknown,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
  );
}

async function finalizeFollowerTransaction(
  context: LibraryCoreFollowerMutationContextV1,
  members: Parameters<typeof assembleLibraryCoreTransactionV1>[0],
) {
  const recovery = await readPwaConsumerRecoveryStatus();
  if (recovery.state !== "none" && (recovery.state !== "following" ||
      String(recovery.plan.authority.library_id) !== context.library_id || String(recovery.plan.authority.epoch_id) !== context.epoch_id ||
      recovery.plan.actorPublicKey !== context.actor_public_key)) {
    throw new Error("PWA recovery enrollment changed before signing");
  }
  const recoveryId = recovery.state === "following" ? recovery.plan.recoveryId : undefined;
  const assembled = assembleLibraryCoreTransactionV1(
    members,
    context.previous_actor_chain_digest,
    { digest },
  );
  let signatureIndex = 0;
  const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
    digest,
    signOperation: async () => {
      const member = assembled.members[signatureIndex++];
      if (!member) {
        throw new Error("PWA follower signer received too many members");
      }
      return signPwaLibraryCoreFollowerOperation(
        context,
        member.signing_body_digest,
        recoveryId,
      );
    },
  });
  if (signatureIndex !== assembled.members.length) {
    throw new Error("PWA follower signer did not sign every member");
  }
  const commit = Object.freeze({
    envelopeBytes: finalized.members.map((member) =>
      encodeLibraryCoreCanonicalValue(
        member.envelope as unknown as LibraryCoreCanonicalValue,
      ),
    ),
  });
  return { commit, finalized };
}

async function commitFollowerTransaction(
  context: LibraryCoreFollowerMutationContextV1,
  members: Parameters<typeof assembleLibraryCoreTransactionV1>[0],
): Promise<LibraryCoreFollowerIntentCommitResultV1> {
  const { commit, finalized } = await finalizeFollowerTransaction(context, members);
  let receipt: LibraryCoreFollowerIntentCommitResultV1;
  try {
    receipt = await commitPwaFollowerIntent(commit);
  } catch (error) {
    if (!isPwaLibraryCoreSqliteWorkerUnavailableError(error)) throw error;
    receipt = await commitPwaFollowerIntent(commit);
  }
  if (
    receipt.actorId !== context.actor_id ||
    receipt.transactionId !== finalized.transaction_body.transaction_id ||
    receipt.firstCounter !== context.next_actor_sequence ||
    receipt.lastCounter !==
      context.next_actor_sequence + finalized.members.length - 1 ||
    receipt.memberCount !== finalized.members.length
  ) {
    throw new Error(
      "PWA follower intent receipt does not match its transaction",
    );
  }
  return receipt;
}

function transactionIdentity(prefix: string): LibraryCoreOperationInstanceId {
  return `${prefix}:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
}

function transactionMemberInput(
  context: LibraryCoreFollowerMutationContextV1,
  transactionId: LibraryCoreOperationInstanceId,
  index: number,
  memberCount: number,
  entityId: string,
  createdAtMs: number,
  payload: Readonly<Record<string, LibraryCoreCanonicalValue>>,
): FeedItemReadAssignmentTransactionMemberInputV1 {
  return {
    actor_id: context.actor_id,
    actor_sequence: context.next_actor_sequence + index,
    causal_frontier: context.observed_frontier,
    created_at_ms: createdAtMs,
    entity_id: entityId,
    epoch: context.epoch,
    epoch_id: context.epoch_id,
    hlc_counter: index,
    hlc_wall_ms: createdAtMs,
    library_id: context.library_id,
    operation_id: `${transactionId}:${index}`,
    payload,
    previous_actor_operation_id:
      index === 0
        ? context.previous_actor_operation_id
        : `${transactionId}:${index - 1}`,
    transaction_id: transactionId,
    transaction_member_count: memberCount,
    transaction_member_index: index,
  };
}

export async function commitPwaLibraryCoreReadAssignments(
  entityIds: readonly string[],
  readAtMs: number,
): Promise<void> {
  const ids = [...new Set(entityIds.filter(Boolean))];
  if (ids.length === 0) return;
  if (ids.length > MAXIMUM_ASSIGNMENT_MEMBERS) {
    throw new RangeError("PWA read assignment transaction is too large");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-read");
  const members = ids.map((entityId, index) =>
    FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: context.actor_id,
        actor_sequence: context.next_actor_sequence + index,
        causal_frontier: context.observed_frontier,
        created_at_ms: readAtMs,
        entity_id: entityId,
        epoch: context.epoch,
        epoch_id: context.epoch_id,
        hlc_counter: index,
        hlc_wall_ms: readAtMs,
        library_id: context.library_id,
        operation_id: `${transactionId}:${index}`,
        payload: { read_at_ms: readAtMs },
        previous_actor_operation_id:
          index === 0
            ? context.previous_actor_operation_id
            : `${transactionId}:${index - 1}`,
        transaction_id: transactionId,
        transaction_member_count: ids.length,
        transaction_member_index: index,
      } satisfies FeedItemReadAssignmentTransactionMemberInputV1,
      { digest },
    ),
  );
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreUserStateAssignments(
  entityIds: readonly string[],
  field: FeedItemUserStateAssignmentFieldV1,
  assigned: boolean,
  assignedAtMs: number,
): Promise<void> {
  const ids = [...new Set(entityIds.filter(Boolean))];
  if (ids.length === 0) return;
  if (ids.length > MAXIMUM_ASSIGNMENT_MEMBERS) {
    throw new RangeError("PWA user-state assignment transaction is too large");
  }
  const schema =
    field === "saved"
      ? FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
      : field === "archived"
        ? FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
        : FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA;
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity(`pwa-${field}`);
  const members = ids.map((entityId, index) =>
    schema.construct(
      {
        actor_id: context.actor_id,
        actor_sequence: context.next_actor_sequence + index,
        causal_frontier: context.observed_frontier,
        created_at_ms: assignedAtMs,
        entity_id: entityId,
        epoch: context.epoch,
        epoch_id: context.epoch_id,
        hlc_counter: index,
        hlc_wall_ms: assignedAtMs,
        library_id: context.library_id,
        operation_id: `${transactionId}:${index}`,
        payload: { assigned, assigned_at_ms: assignedAtMs },
        previous_actor_operation_id:
          index === 0
            ? context.previous_actor_operation_id
            : `${transactionId}:${index - 1}`,
        transaction_id: transactionId,
        transaction_member_count: ids.length,
        transaction_member_index: index,
      } satisfies FeedItemUserStateAssignmentTransactionMemberInputV1,
      { digest },
    ),
  );
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreFeedItemCaptures(
  items: readonly FeedItem[],
  createdAtMs: number,
): Promise<void> {
  if (
    items.length === 0 ||
    items.length > PWA_LIBRARY_CORE_SQLITE_CAPTURE_BATCH_LIMIT
  ) {
    throw new RangeError("PWA FeedItem capture transaction is too large");
  }
  const identities = new Set<string>();
  for (const item of items) {
    if (!item.globalId)
      throw new TypeError("capture item global ID is required");
    if (identities.has(item.globalId)) {
      throw new TypeError(
        "FeedItem capture transaction contains a duplicate ID",
      );
    }
    identities.add(item.globalId);
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-capture");
  const members = items.map((item, index) =>
    FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: context.actor_id,
        actor_sequence: context.next_actor_sequence + index,
        causal_frontier: context.observed_frontier,
        created_at_ms: createdAtMs,
        entity_id: item.globalId,
        epoch: context.epoch,
        epoch_id: context.epoch_id,
        hlc_counter: index,
        hlc_wall_ms: createdAtMs,
        library_id: context.library_id,
        operation_id: `${transactionId}:${index}`,
        payload: {
          item: encodeLibraryCoreFractionalNumbersV1(item) as Record<
            string,
            LibraryCoreCanonicalValue
          >,
        },
        previous_actor_operation_id:
          index === 0
            ? context.previous_actor_operation_id
            : `${transactionId}:${index - 1}`,
        transaction_id: transactionId,
        transaction_member_count: items.length,
        transaction_member_index: index,
      } satisfies FeedItemCaptureUpsertTransactionMemberInputV1,
      { digest },
    ),
  );
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreFeedItemAnnotationSets(
  assignments: readonly Readonly<{
    entityId: string;
    highlights: FeedItemAnnotationsReplacePayloadV1["highlights"];
    tags: readonly string[];
  }>[],
  assignedAtMs: number,
): Promise<void> {
  if (
    assignments.length === 0 ||
    assignments.length > PWA_LIBRARY_CORE_SQLITE_ANNOTATION_BATCH_LIMIT
  ) {
    throw new RangeError("PWA FeedItem annotation transaction is too large");
  }
  const identities = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment.entityId)
      throw new TypeError("annotation entity ID is required");
    if (identities.has(assignment.entityId)) {
      throw new TypeError(
        "FeedItem annotation transaction contains a duplicate ID",
      );
    }
    identities.add(assignment.entityId);
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-feed-item-annotations");
  const members = assignments.map((assignment, index) =>
    FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: context.actor_id,
        actor_sequence: context.next_actor_sequence + index,
        causal_frontier: context.observed_frontier,
        created_at_ms: assignedAtMs,
        entity_id: assignment.entityId,
        epoch: context.epoch,
        epoch_id: context.epoch_id,
        hlc_counter: index,
        hlc_wall_ms: assignedAtMs,
        library_id: context.library_id,
        operation_id: `${transactionId}:${index}`,
        payload: {
          assigned_at_ms: assignedAtMs,
          highlights: assignment.highlights,
          tags: assignment.tags,
        },
        previous_actor_operation_id:
          index === 0
            ? context.previous_actor_operation_id
            : `${transactionId}:${index - 1}`,
        transaction_id: transactionId,
        transaction_member_count: assignments.length,
        transaction_member_index: index,
      } satisfies FeedItemAnnotationsReplaceTransactionMemberInputV1,
      { digest },
    ),
  );
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreFeedItemAnalysisSets(
  assignments: readonly Readonly<{
    analysis: Readonly<
      Pick<
        FeedItemAnalysisReplacePayloadV1,
        "content_signals" | "event_candidate"
      >
    >;
    entityId: string;
  }>[],
  assignedAtMs: number,
): Promise<void> {
  if (
    assignments.length === 0 ||
    assignments.length > PWA_LIBRARY_CORE_SQLITE_ANALYSIS_BATCH_LIMIT
  ) {
    throw new RangeError("PWA FeedItem analysis transaction is too large");
  }
  const identities = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment.entityId)
      throw new TypeError("analysis entity ID is required");
    if (identities.has(assignment.entityId)) {
      throw new TypeError("FeedItem analysis transaction contains a duplicate ID");
    }
    identities.add(assignment.entityId);
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-feed-item-analysis");
  const members = assignments.map((assignment, index) =>
    FEED_ITEM_ANALYSIS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: context.actor_id,
        actor_sequence: context.next_actor_sequence + index,
        causal_frontier: context.observed_frontier,
        created_at_ms: assignedAtMs,
        entity_id: assignment.entityId,
        epoch: context.epoch,
        epoch_id: context.epoch_id,
        hlc_counter: index,
        hlc_wall_ms: assignedAtMs,
        library_id: context.library_id,
        operation_id: `${transactionId}:${index}`,
        payload: {
          assigned_at_ms: assignedAtMs,
          ...assignment.analysis,
        },
        previous_actor_operation_id:
          index === 0
            ? context.previous_actor_operation_id
            : `${transactionId}:${index - 1}`,
        transaction_id: transactionId,
        transaction_member_count: assignments.length,
        transaction_member_index: index,
      } satisfies FeedItemAnalysisReplaceTransactionMemberInputV1,
      { digest },
    ),
  );
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreFeedItemRemove(
  entityId: string,
  removedAtMs: number,
): Promise<void> {
  await commitPwaLibraryCoreFeedItemRemoves([entityId], removedAtMs);
}

function itemRemovalMembers(
  context: Awaited<ReturnType<typeof readPwaFollowerMutationContext>>, identities: readonly string[],
  transactionId: LibraryCoreOperationInstanceId, removedAtMs: number,
) {
  return identities.map((entityId, index) =>
    FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(
        context,
        transactionId,
        index,
        identities.length,
        entityId,
        removedAtMs,
        { removed_at_ms: removedAtMs },
      ) satisfies FeedItemRemoveTransactionMemberInputV1,
      { digest },
    ),
  );
}

export async function commitPwaLibraryCoreFeedItemRemoves(
  entityIds: readonly string[],
  removedAtMs: number,
): Promise<void> {
  const identities = [...new Set(entityIds)];
  if (
    identities.length < 1 ||
    identities.length >
      LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_remove.maximumMembers ||
    identities.some((entityId) => !entityId)
  ) {
    throw new RangeError("PWA FeedItem removal transaction is invalid");
  }
  if (!Number.isSafeInteger(removedAtMs) || removedAtMs < 0) {
    throw new TypeError("remove time must be a nonnegative integer");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-feed-item-remove");
  const members = itemRemovalMembers(context, identities, transactionId, removedAtMs);
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreRssFeedUpsert(
  feed: RssFeed,
  createdAtMs: number,
): Promise<void> {
  await commitPwaLibraryCoreRssFeedUpserts([feed], createdAtMs);
}

export async function commitPwaLibraryCoreRssFeedUpserts(
  feeds: readonly RssFeed[],
  createdAtMs: number,
): Promise<void> {
  if (
    feeds.length === 0 ||
    feeds.length > PWA_LIBRARY_CORE_SQLITE_RSS_FEED_BATCH_LIMIT
  ) {
    throw new RangeError("PWA RSS feed transaction is too large");
  }
  const identities = new Set<string>();
  for (const feed of feeds) {
    if (!feed.url) throw new TypeError("RSS feed URL is required");
    if (identities.has(feed.url)) {
      throw new TypeError("RSS feed transaction contains a duplicate URL");
    }
    identities.add(feed.url);
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-rss-upsert");
  const members = rssUpsertMembers(context, feeds, transactionId, createdAtMs);
  await commitFollowerTransaction(context, members);
}

function rssUpsertMembers(context: LibraryCoreFollowerMutationContextV1, feeds: readonly RssFeed[], transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return feeds.map((feed, index) =>
    RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(
        context,
        transactionId,
        index,
        feeds.length,
        feed.url,
        createdAtMs,
        { feed: feed as unknown as LibraryCoreCanonicalValue },
      ),
      { digest },
    ),
  );
}

export async function commitPwaLibraryCoreRssFeedTitleAssignment(
  url: string,
  title: string,
  assignedAtMs: number,
): Promise<void> {
  if (!url) throw new TypeError("RSS feed URL is required");
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-rss-title");
  const member = RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(context, transactionId, 0, 1, url, assignedAtMs, {
      assigned_at_ms: assignedAtMs,
      title,
    }),
    { digest },
  );
  await commitFollowerTransaction(context, [member]);
}

export async function commitPwaLibraryCoreRssFeedRemove(
  url: string,
  includeItems: boolean,
  removedAtMs: number,
): Promise<void> {
  await commitPwaLibraryCoreRssFeedRemoves([url], includeItems, removedAtMs);
}

export async function commitPwaLibraryCoreRssFeedRemoves(
  urls: readonly string[],
  includeItems: boolean,
  removedAtMs: number,
): Promise<void> {
  const identities = [...new Set(urls)];
  const maximumMembers = includeItems
    ? LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.rss_feed_remove_with_items
        .maximumMembers
    : LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.rss_feed_remove_keep_items
        .maximumMembers;
  if (
    identities.length < 1 ||
    identities.length > maximumMembers ||
    identities.some((url) => !url)
  ) {
    throw new RangeError("PWA RSS Feed removal transaction is invalid");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-rss-remove");
  const schema = includeItems
    ? RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA
    : RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA;
  const members = identities.map((url, index) =>
    schema.construct(
      transactionMemberInput(
        context,
        transactionId,
        index,
        identities.length,
        url,
        removedAtMs,
        { removed_at_ms: removedAtMs },
      ),
      { digest },
    ),
  );
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCorePreferencesPatch(
  updates: Partial<UserPreferences>,
  createdAtMs: number,
): Promise<void> {
  const encoded = encodeLibraryCoreFractionalNumbersV1(updates);
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-preferences");
  await commitFollowerTransaction(context, preferenceMembers(context, [encoded as Readonly<Record<string, LibraryCoreCanonicalValue>>], transactionId, createdAtMs));
}

function preferenceMembers(context: LibraryCoreFollowerMutationContextV1,
  patches: readonly Readonly<Record<string, LibraryCoreCanonicalValue>>[], transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return patches.map((updates, index) => PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(context, transactionId, index, patches.length, "preferences", createdAtMs, { updates }), { digest }));
}

/** Preserve complete patch order and retain the finalized action after an ambiguous result. */
export function createPwaRecoveryPreferenceAction(review: LibraryCoreRecoveryIntentReviewResponseV1, patches: readonly unknown[]): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  const selected = snapshotLibraryCoreRecoveryPreferencePatchesV1(patches);
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryPreferenceDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.length !== original.drafts.length || selected.some((patch, index) => !sameLibraryCoreRecoveryPreferenceScopeV1(original.drafts[index]!.updates, patch)))
      throw new Error("Review every original preference assignment without adding or dropping fields");
    const context = await readPwaFollowerMutationContext(), now = Date.now();
    const { commit } = await finalizeFollowerTransaction(context, preferenceMembers(context, selected, transactionIdentity("pwa-recovery-preferences"), now));
    return { intent: commit };
  });
}

function personUpsertMembers(context: LibraryCoreFollowerMutationContextV1, persons: readonly Person[], transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return persons.map((person, index) =>
    PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(
        context,
        transactionId,
        index,
        persons.length,
        person.id,
        createdAtMs,
        { person: person as unknown as LibraryCoreCanonicalValue },
      ),
      { digest },
    ),
  );
}

export function createPwaRecoveryPersonAction(review: LibraryCoreRecoveryIntentReviewResponseV1, persons: readonly Person[]): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  if (persons.length === 0 || persons.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_upsert.maximumMembers)
    throw new Error("Recovery transaction exceeds its member bound");
  let bytes = 0;
  const selected = persons.map(person => {
    const validated = PERSON_UPSERT_PAYLOAD_SCHEMA.validate({ person });
    if (!validated.ok) throw new Error("Person values are invalid");
    bytes += encodeLibraryCoreCanonicalValue(validated.value.person).length;
    if (bytes > 4194304) throw new Error("Recovery transaction exceeds its byte bound");
    return structuredClone(validated.value.person) as unknown as Person;
  });
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryPersonDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.length !== original.drafts.length || selected.some((person, i) => person.id !== original.drafts[i]!.archived.id))
      throw new Error("Review the complete original Person set.");
    const context = await readPwaFollowerMutationContext();
    const now = Date.now();
    const members = personUpsertMembers(context, selected.map(person => ({ ...person, updatedAt: now })), transactionIdentity("pwa-recovery-person"), now);
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}

export async function commitPwaLibraryCorePersonUpserts(
  persons: readonly Person[],
  createdAtMs: number,
): Promise<void> {
  if (
    persons.length === 0 ||
    persons.length > PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT
  ) {
    throw new RangeError("PWA Person transaction is too large");
  }
  const identities = new Set<string>();
  for (const person of persons) {
    if (!person.id) throw new TypeError("Person ID is required");
    if (identities.has(person.id)) {
      throw new TypeError("Person transaction contains a duplicate ID");
    }
    identities.add(person.id);
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-person-upsert");
  const members = personUpsertMembers(context, persons, transactionId, createdAtMs);
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCorePersonReachOutAppend(
  personId: string,
  entry: ReachOutLog,
  createdAtMs: number,
): Promise<void> {
  if (!personId) throw new TypeError("Person ID is required");
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-person-reach-out");
  await commitFollowerTransaction(context, reachOutMembers(context, [{ personId, event: {
    channel: entry.channel ?? null, logged_at_ms: entry.loggedAt, notes: entry.notes ?? null,
  } }], transactionId, createdAtMs));
}

function reachOutMembers(context: Awaited<ReturnType<typeof readPwaFollowerMutationContext>>,
  entries: readonly { personId: string; event: RecoveryReachOutDraft["event"] }[], transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return entries.map(({ personId, event }, index) => PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(context, transactionId, index, entries.length, personId, createdAtMs, { ...event }) satisfies PersonReachOutAppendTransactionMemberInputV1,
    { digest },
  ));
}

export function createPwaRecoveryReachOutAction(review: LibraryCoreRecoveryIntentReviewResponseV1, drafts: readonly RecoveryReachOutDraft[]): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  if (!drafts.length || drafts.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_reach_out_append.maximumMembers) throw new Error("Recovery exceeds its member bound");
  let bytes = 0;
  const selected = drafts.map(draft => {
    const payload = PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA.validate(draft.event);
    if (!payload.ok) throw new Error("Reach-out event is invalid");
    bytes += encodeLibraryCoreCanonicalValue({ ...payload.value }).length;
    if (bytes > 4194304) throw new Error("Recovery exceeds its byte bound");
    return { personId: draft.personId, event: structuredClone(payload.value) };
  });
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryReachOutDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.length !== original.drafts.length || selected.some((entry, i) => entry.personId !== original.drafts[i]!.personId)) throw new Error("Review the complete original event set");
    const context = await readPwaFollowerMutationContext(), now = Date.now();
    const { commit } = await finalizeFollowerTransaction(context, reachOutMembers(context, selected, transactionIdentity("pwa-recovery-reach-out"), now));
    return { intent: commit };
  });
}

function friendReplaceMember(context: Awaited<ReturnType<typeof readPwaFollowerMutationContext>>,
  person: Person, accounts: readonly Account[], transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(
      context,
      transactionId,
      0,
      1,
      person.id,
      createdAtMs,
      {
        accounts: accounts as unknown as LibraryCoreCanonicalValue,
        person: person as unknown as LibraryCoreCanonicalValue,
      },
    ) satisfies FriendReplaceTransactionMemberInputV1,
    { digest },
  );
}

/** Retain one finalized replacement across ambiguous browser commit responses. */
export function createPwaRecoveryFriendAction(review: LibraryCoreRecoveryIntentReviewResponseV1, person: Person, accounts: readonly Account[]): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  const parsed = FRIEND_REPLACE_PAYLOAD_SCHEMA.validate({ accounts: [...accounts].sort((a, b) => compareLibraryCoreUtf8V1(a.id, b.id)), person });
  if (!parsed.ok) throw new Error("The complete Friend replacement is invalid or oversized");
  const selected = structuredClone(parsed.value);
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryFriendDraft(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.person.id !== original.draft.archivedPerson.id) throw new Error("Review the original Friend target");
    const context = await readPwaFollowerMutationContext();
    const now = Date.now();
    const member = friendReplaceMember(context, { ...selected.person, updatedAt: now } as unknown as Person,
      selected.accounts.map(account => ({ ...account, updatedAt: now })) as unknown as Account[], transactionIdentity("pwa-recovery-friend"), now);
    const { commit } = await finalizeFollowerTransaction(context, [member]);
    return { intent: commit };
  });
}

export async function commitPwaLibraryCoreFriendReplace(
  person: Person,
  accounts: readonly Account[],
  createdAtMs: number,
): Promise<void> {
  if (
    accounts.length > FRIEND_REPLACE_MAXIMUM_ACCOUNTS ||
    accounts.some((account) => account.personId !== person.id)
  ) {
    throw new RangeError("Friend Account window is invalid");
  }
  const sortedAccounts = [...accounts].sort((left, right) =>
    compareLibraryCoreUtf8V1(left.id, right.id),
  );
  if (
    new Set(sortedAccounts.map((account) => account.id)).size !==
    sortedAccounts.length
  ) {
    throw new TypeError("Friend Account window contains duplicate IDs");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-friend-replace");
  const member = friendReplaceMember(context, person, sortedAccounts, transactionId, createdAtMs);
  await commitFollowerTransaction(context, [member]);
}

export async function commitPwaLibraryCorePersonRemove(
  personId: string,
  removedAtMs: number,
): Promise<void> {
  await commitPwaLibraryCorePersonRemoves([personId], removedAtMs);
}

function personRemovalMembers(context: Awaited<ReturnType<typeof readPwaFollowerMutationContext>>,
  identities: readonly string[], transactionId: LibraryCoreOperationInstanceId, removedAtMs: number,
) {
  return identities.map((personId, index) =>
    PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(
        context,
        transactionId,
        index,
        identities.length,
        personId,
        removedAtMs,
        { removed_at_ms: removedAtMs },
      ),
      { digest },
    ),
  );
}

export async function commitPwaLibraryCorePersonRemoves(
  personIds: readonly string[],
  removedAtMs: number,
): Promise<void> {
  const identities = [...new Set(personIds)];
  if (
    identities.length < 1 ||
    identities.length >
      LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_remove_and_accounts
        .maximumMembers ||
    identities.some((personId) => !personId)
  ) {
    throw new RangeError("PWA Person removal transaction is invalid");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-person-remove");
  const members = personRemovalMembers(context, identities, transactionId, removedAtMs);
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreAccountPersonAssignment(
  accountId: string,
  personId: string | null,
  assignedAtMs: number,
): Promise<void> {
  if (!accountId) throw new TypeError("Account ID is required");
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-account-person");
  await commitFollowerTransaction(context, accountPersonMembers(context, [{ accountId, personId }], transactionId, assignedAtMs));
}

function accountPersonMembers(context: LibraryCoreFollowerMutationContextV1,
  assignments: readonly { accountId: string; personId: string | null }[],
  transactionId: LibraryCoreOperationInstanceId, assignedAtMs: number,
) {
  return assignments.map(({ accountId, personId }, index) => ACCOUNT_PERSON_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(context, transactionId, index, assignments.length, accountId, assignedAtMs,
      { assigned_at_ms: assignedAtMs, person_id: personId }) satisfies AccountPersonAssignmentTransactionMemberInputV1, { digest }));
}

/** Snapshot owner choices, verify all original targets, then retain one signed replacement. */
export function createPwaRecoveryAccountLinkAction(review: LibraryCoreRecoveryIntentReviewResponseV1,
  assignments: readonly { accountId: string; personId: string | null }[],
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  if (assignments.length === 0 || assignments.length > 1000) throw new Error("Recovery transaction exceeds its member bound.");
  const selected = assignments.map(({ accountId, personId }) => ({ accountId, personId }));
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryAccountLinkDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.length !== original.drafts.length || selected.some((row, i) => row.accountId !== original.drafts[i]!.accountId))
      throw new Error("Review the complete original account set.");
    for (const row of selected) {
      if (row.personId === null) continue;
      const current = await queryPwaNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId: row.personId });
      if (!current.person || current.person.id !== row.personId || current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
        throw new Error("The selected person or Library changed. Review the account links again.");
    }
    const context = await readPwaFollowerMutationContext();
    const members = accountPersonMembers(context, selected, transactionIdentity("pwa-recovery-account-link"), Date.now());
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}

function accountUpsertMembers(context: LibraryCoreFollowerMutationContextV1, accounts: readonly Account[],
  transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return accounts.map((account, index) =>
    ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(
        context,
        transactionId,
        index,
        accounts.length,
        account.id,
        createdAtMs,
        { account: account as unknown as LibraryCoreCanonicalValue },
      ),
      { digest },
    ),
  );
}

export function createPwaRecoveryAccountAction(review: LibraryCoreRecoveryIntentReviewResponseV1, accounts: readonly Account[]): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  if (accounts.length === 0 || accounts.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_upsert.maximumMembers)
    throw new Error("Recovery transaction exceeds its member bound");
  let bytes = 0;
  const selected = accounts.map(account => {
    const validated = ACCOUNT_UPSERT_PAYLOAD_SCHEMA.validate({ account });
    if (!validated.ok) throw new Error("Account values are invalid");
    bytes += encodeLibraryCoreCanonicalValue(validated.value.account).length;
    if (bytes > 4194304) throw new Error("Recovery transaction exceeds its byte bound");
    return structuredClone(validated.value.account) as unknown as Account;
  });
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryAccountDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.length !== original.drafts.length || selected.some((account, i) => account.id !== original.drafts[i]!.archived.id))
      throw new Error("Review the complete original Account set.");
    for (const account of selected) {
      if (!account.personId) continue;
      const current = await queryPwaNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId: account.personId });
      if (!current.person || current.person.id !== account.personId || current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
        throw new Error("The selected person or Library changed. Review the Account details again.");
    }
    const context = await readPwaFollowerMutationContext();
    const now = Date.now();
    const members = accountUpsertMembers(context, selected.map(account => ({ ...account, updatedAt: now })), transactionIdentity("pwa-recovery-account"), now);
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}
export async function commitPwaLibraryCoreAccountUpserts(
  accounts: readonly Account[],
  createdAtMs: number,
): Promise<void> {
  if (
    accounts.length === 0 ||
    accounts.length > PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT
  ) {
    throw new RangeError("PWA Account transaction is too large");
  }
  const identities = new Set<string>();
  for (const account of accounts) {
    if (!account.id) throw new TypeError("Account ID is required");
    if (identities.has(account.id)) {
      throw new TypeError("Account transaction contains a duplicate ID");
    }
    identities.add(account.id);
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-account-upsert");
  const members = accountUpsertMembers(context, accounts, transactionId, createdAtMs);
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreAccountRemove(
  accountId: string,
  removedAtMs: number,
): Promise<void> {
  await commitPwaLibraryCoreAccountRemoves([accountId], removedAtMs);
}

function accountRemovalMembers(
  context: LibraryCoreFollowerMutationContextV1, identities: readonly string[],
  transactionId: LibraryCoreOperationInstanceId, removedAtMs: number,
) {
  return identities.map((accountId, index) =>
    ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(
        context,
        transactionId,
        index,
        identities.length,
        accountId,
        removedAtMs,
        { removed_at_ms: removedAtMs },
      ),
      { digest },
    ),
  );
}

export async function commitPwaLibraryCoreAccountRemoves(
  accountIds: readonly string[],
  removedAtMs: number,
): Promise<void> {
  const identities = [...new Set(accountIds)];
  if (
    identities.length < 1 ||
    identities.length >
      LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_remove.maximumMembers ||
    identities.some((accountId) => !accountId)
  ) {
    throw new RangeError("PWA Account removal transaction is invalid");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-account-remove");
  const members = accountRemovalMembers(context, identities, transactionId, removedAtMs);
  await commitFollowerTransaction(context, members);
}

/** One explicit action owns finalized bytes until its durable link is known. */
function createRecoveryTransactionAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1,
  prepare: () => Promise<{ intent: LibraryCoreFollowerIntentCommitV1 } | { receipt: LibraryCoreRecoveryReissueReceiptV1 }>,
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  let prepared: LibraryCoreReapplyConsumerIntentV1 | undefined;
  let flight: Promise<LibraryCoreRecoveryReissueReceiptV1> | undefined;
  let receipt: LibraryCoreRecoveryReissueReceiptV1 | undefined;
  async function apply(): Promise<LibraryCoreRecoveryReissueReceiptV1> {
    if (receipt) return receipt;
    if (!prepared) {
      const result = await prepare();
      if ("receipt" in result) return result.receipt;
      prepared = parseLibraryCoreReapplyConsumerIntentV1({ review: { schemaVersion: 1, recoveryId: review.recoveryId, archiveDigest: review.archiveDigest,
        transactionId: review.transactionId, transactionDigest: review.transactionDigest, memberCount: review.memberCount,
        reviewedGenerationId: review.source.generationId, reviewedRevision: review.source.projectionRevision,
        reviewedLocalSequence: review.source.transitionSequence }, intent: result.intent });
    }
    // Explicit retry submits the same finalized bytes after an ambiguous result.
    return reapplyPwaConsumerIntent(prepared);
  }
  return () => {
    if (!flight) flight = apply().then(value => { receipt = value; return value; }).finally(() => { flight = undefined; });
    return flight;
  };
}

/** Reopening first checks for a committed link before touching the key again. */
export function createPwaRecoveryAssignmentAction(review: LibraryCoreRecoveryIntentReviewResponseV1): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  return createRecoveryTransactionAction(review, async () => {
      // Retain only assignment inputs, never every page's item context in React.
      const assignments: { operation: string; entityId: string; assigned: boolean | null }[] = [];
      let cursor: string | null = null;
      do {
        const request = parseLibraryCoreRecoveryIntentReviewRequestV1({ queryId: "recovery_intent_review_v1", schemaVersion: 1,
          recoveryId: review.recoveryId, transactionId: review.transactionId, cursor, limit: 16,
          cancellationId: crypto.randomUUID(), readerSessionId: crypto.randomUUID() });
        if (!request.ok) throw new Error(request.error);
        const page = await queryPwaNormalizedLibrary(request.value);
        if (page.archiveDigest !== review.archiveDigest || page.transactionDigest !== review.transactionDigest || page.memberCount !== review.memberCount) {
          throw new Error("The preserved edit changed. Verify it again.");
        }
        // A previous successful action wins even if today's Library or enrollment changed.
        if (page.replacement) return { receipt: page.replacement };
        if (page.outcome.state === "confirmed_accepted") throw new Error("This edit was already accepted.");
        if (page.source.generationId !== review.source.generationId || page.source.projectionRevision !== review.source.projectionRevision ||
            page.source.transitionSequence !== review.source.transitionSequence) throw new Error("The Library changed. Verify this edit again.");
        for (const row of page.rows) {
          if (row.memberIndex !== assignments.length || row.itemPresent !== true ||
              !["feed_item_read_assignment", "feed_item_saved_assignment", "feed_item_archive_assignment", "feed_item_like_assignment"].includes(row.operationType) ||
              (row.operationType !== "feed_item_read_assignment" && typeof row.assigned !== "boolean")) {
            throw new Error("This edit needs its original editor or contains an unavailable item.");
          }
          assignments.push({ operation: row.operationType, entityId: row.entityId, assigned: row.assigned });
        }
        if (assignments.length > 1000 || (page.nextCursor && assignments.length >= review.memberCount)) throw new Error("Recovery transaction is too large.");
        cursor = page.nextCursor;
      } while (cursor !== null);
      if (assignments.length !== review.memberCount) throw new Error("The preserved transaction is incomplete.");
      const context = await readPwaFollowerMutationContext();
      const transactionId = transactionIdentity("pwa-recovery");
      const now = Date.now();
      const members = assignments.map((assignment, index) => {
        const input = transactionMemberInput(context, transactionId, index, assignments.length, assignment.entityId, now,
          assignment.operation === "feed_item_read_assignment" ? { read_at_ms: now } : { assigned: assignment.assigned!, assigned_at_ms: now });
        const schema = assignment.operation === "feed_item_read_assignment" ? FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA :
          assignment.operation === "feed_item_saved_assignment" ? FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA :
          assignment.operation === "feed_item_archive_assignment" ? FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA : FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA;
        return schema.construct(input, { digest });
      });
      const { commit } = await finalizeFollowerTransaction(context, members);
      return { intent: commit };
  });
}

/** Revised titles retain the original transaction's entire ordered feed set. */
export function createPwaRecoveryRssTitleAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1,
  titles: readonly { readonly url: string; readonly title: string }[],
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  const selected = titles.map(row => ({ url: row.url, title: row.title.trim() }));
  return createRecoveryTransactionAction(review, async () => {
    const current = await loadPwaRecoveryRssTitleDrafts(review);
    if (current.replacement) return { receipt: current.replacement };
    if (selected.length !== current.drafts.length || selected.some((row, index) => row.url !== current.drafts[index]!.url ||
        !row.title || new TextEncoder().encode(row.title).length > 4096)) throw new Error("Review every complete feed name before storing it.");
    const context = await readPwaFollowerMutationContext();
    const transactionId = transactionIdentity("pwa-recovery-rss");
    const now = Date.now();
    const members = selected.map((row, index) => RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(context, transactionId, index, selected.length, row.url, now, { title: row.title, assigned_at_ms: now }), { digest }));
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}

/** Explicit annotation recovery preserves every original item, with revised full sets. */
export function createPwaRecoveryAnnotationAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1,
  drafts: readonly { readonly entityId: string; readonly highlights: FeedItemAnnotationsReplacePayloadV1["highlights"]; readonly tags: readonly string[] }[],
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  const selected = drafts.map(row => ({ entityId: row.entityId, highlights: row.highlights.map(highlight => ({ ...highlight })), tags: canonicalizeFeedItemTagsV1(row.tags) }));
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryAnnotationDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.length !== original.drafts.length || selected.length > PWA_LIBRARY_CORE_SQLITE_ANNOTATION_BATCH_LIMIT ||
        selected.some((row, index) => row.entityId !== original.drafts[index]!.entityId)) throw new Error("Review the complete original item set.");
    const context = await readPwaFollowerMutationContext();
    const transactionId = transactionIdentity("pwa-recovery-annotations"), now = Date.now();
    const members = selected.map((row, index) => FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(context, transactionId, index, selected.length, row.entityId, now,
        { assigned_at_ms: now, highlights: row.highlights, tags: row.tags }), { digest }));
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}

/** An explicit unsubscribe retains the archived deletion scope and all feed targets. */
export function createPwaRecoveryRssRemovalAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1, confirmedDeleteItems: boolean,
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryRssRemovalDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    const includeItems = original.drafts[0]!.includeItems;
    if (includeItems && !confirmedDeleteItems) throw new Error("Confirm deletion of these feeds' articles and reading history first.");
    const program = includeItems ? LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.rss_feed_remove_with_items : LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.rss_feed_remove_keep_items;
    if (original.drafts.length > program.maximumMembers) throw new Error("The complete unsubscribe transaction is too large.");
    const context = await readPwaFollowerMutationContext();
    const transactionId = transactionIdentity("pwa-recovery-unsubscribe"), now = Date.now();
    const schema = includeItems ? RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA : RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA;
    const members = original.drafts.map((row, index) => schema.construct(transactionMemberInput(context, transactionId, index,
      original.drafts.length, row.url, now, { removed_at_ms: now }), { digest }));
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}

/** Reapply the fixed original deletion set, never a current bulk filter. */
export function createPwaRecoveryItemRemovalAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1, confirmed: boolean,
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryItemRemovalDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (!confirmed) throw new Error("Confirm deletion of these original items first.");
    if (original.drafts.length === 0 || original.drafts.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_remove.maximumMembers)
      throw new Error("The complete deletion transaction is too large.");
    const context = await readPwaFollowerMutationContext();
    const members = itemRemovalMembers(context, original.drafts.map(row => row.entityId), transactionIdentity("pwa-recovery-item-removal"), Date.now());
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}

/** Reapply the fixed original deletion set, never a current bulk filter. */
export function createPwaRecoveryPersonRemovalAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1, confirmed: boolean,
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryPersonRemovalDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (!confirmed) throw new Error("Confirm deletion of these people and their linked accounts first.");
    if (original.drafts.length === 0 || original.drafts.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_remove_and_accounts.maximumMembers)
      throw new Error("The complete deletion transaction is too large.");
    const context = await readPwaFollowerMutationContext();
    const members = personRemovalMembers(context, original.drafts.map(row => row.entityId), transactionIdentity("pwa-recovery-person-removal"), Date.now());
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}

/** Reverify every Account target before signing one explicit replacement. */
export function createPwaRecoveryAccountRemovalAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1, confirmed: boolean,
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryAccountRemovalDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (!confirmed) throw new Error("Confirm deletion of these accounts from the Library first.");
    if (original.drafts.length === 0 || original.drafts.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_remove.maximumMembers)
      throw new Error("The complete deletion transaction is too large.");
    const context = await readPwaFollowerMutationContext();
    const members = accountRemovalMembers(context, original.drafts.map(row => row.entityId), transactionIdentity("pwa-recovery-account-removal"), Date.now());
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}


/** Snapshot explicit settings, then reverify every original target before signing. */
export function createPwaRecoveryRssUpsertAction(
  review: LibraryCoreRecoveryIntentReviewResponseV1, feeds: readonly RssFeed[],
): () => Promise<LibraryCoreRecoveryReissueReceiptV1> {
  if (feeds.length === 0 || feeds.length > 1000) throw new Error("Recovery transaction exceeds its bounds.");
  let bytes = 0;
  const selected = feeds.map((feed) => {
    const result = RSS_FEED_UPSERT_PAYLOAD_SCHEMA.validate({ feed });
    if (!result.ok) throw new Error("Subscription settings are invalid.");
    bytes += encodeLibraryCoreCanonicalValue(result.value.feed).length;
    if (bytes > 4194304) throw new Error("Recovery transaction exceeds its bounds.");
    return result.value.feed as unknown as RssFeed;
  });
  return createRecoveryTransactionAction(review, async () => {
    const original = await loadPwaRecoveryRssUpsertDrafts(review);
    if (original.replacement) return { receipt: original.replacement };
    if (selected.length !== original.drafts.length || selected.some((feed, i) => feed.url !== original.drafts[i]!.archived.url))
      throw new Error("Review the complete original subscription set.");
    const revised = selected.map((feed, i) => {
      const { lastFetched: _oldFetch, sampleDataFingerprint: _oldSample, ...settings } = feed;
      const draft = original.drafts[i]!;
      const current = draft.current;
      const provenance = (current ?? draft.archived).sampleDataFingerprint;
      return { ...settings,
        ...(current?.lastFetched === undefined ? {} : { lastFetched: current.lastFetched }),
        ...(provenance === undefined ? {} : { sampleDataFingerprint: provenance }),
      };
    });
    const context = await readPwaFollowerMutationContext();
    const members = rssUpsertMembers(context, revised, transactionIdentity("pwa-recovery-rss-upsert"), Date.now());
    const { commit } = await finalizeFollowerTransaction(context, members);
    return { intent: commit };
  });
}
