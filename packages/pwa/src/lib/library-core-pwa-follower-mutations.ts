import {
  assembleLibraryCoreTransactionV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FRIEND_REPLACE_MAXIMUM_ACCOUNTS,
  FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  encodeLibraryCoreFractionalNumbersV1,
  ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
  finalizeLibraryCoreTransactionV1,
  sha256LowerHex,
  type FeedItemCaptureUpsertTransactionMemberInputV1,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type FeedItemRemoveTransactionMemberInputV1,
  type FeedItemUserStateAssignmentFieldV1,
  type FeedItemUserStateAssignmentTransactionMemberInputV1,
  type FriendReplaceTransactionMemberInputV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerMutationContextV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";
import type {
  Account,
  FeedItem,
  Person,
  RssFeed,
  UserPreferences,
} from "@freed/shared";
import { signPwaLibraryCoreFollowerOperation } from "./library-core-browser-key-vault";
import {
  commitPwaFollowerIntent,
  readPwaFollowerMutationContext,
} from "./library-core-sqlite-runtime";

const MAXIMUM_ASSIGNMENT_MEMBERS = 1_000;
export const PWA_LIBRARY_CORE_SQLITE_CAPTURE_BATCH_LIMIT =
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_capture_upsert.maximumMembers;
export const PWA_LIBRARY_CORE_SQLITE_RECORD_BATCH_LIMIT = Math.min(
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_upsert.maximumMembers,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_upsert.maximumMembers,
);

function digest(
  domain: LibraryCoreDigestDomain,
  value: unknown,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
  );
}

async function commitFollowerTransaction(
  context: LibraryCoreFollowerMutationContextV1,
  members: Parameters<typeof assembleLibraryCoreTransactionV1>[0],
): Promise<LibraryCoreFollowerIntentCommitResultV1> {
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
  let receipt: LibraryCoreFollowerIntentCommitResultV1;
  try {
    receipt = await commitPwaFollowerIntent(commit);
  } catch (error) {
    if (!String(error).includes("request timed out")) throw error;
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

export async function commitPwaLibraryCoreFeedItemRemove(
  entityId: string,
  removedAtMs: number,
): Promise<void> {
  if (!entityId) throw new TypeError("remove entity ID is required");
  if (!Number.isSafeInteger(removedAtMs) || removedAtMs < 0) {
    throw new TypeError("remove time must be a nonnegative integer");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-feed-item-remove");
  const member = FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
    {
      actor_id: context.actor_id,
      actor_sequence: context.next_actor_sequence,
      causal_frontier: context.observed_frontier,
      created_at_ms: removedAtMs,
      entity_id: entityId,
      epoch: context.epoch,
      epoch_id: context.epoch_id,
      hlc_counter: 0,
      hlc_wall_ms: removedAtMs,
      library_id: context.library_id,
      operation_id: `${transactionId}:0`,
      payload: { removed_at_ms: removedAtMs },
      previous_actor_operation_id: context.previous_actor_operation_id,
      transaction_id: transactionId,
      transaction_member_count: 1,
      transaction_member_index: 0,
    } satisfies FeedItemRemoveTransactionMemberInputV1,
    { digest },
  );
  await commitFollowerTransaction(context, [member]);
}

export async function commitPwaLibraryCoreRssFeedUpsert(
  feed: RssFeed,
  createdAtMs: number,
): Promise<void> {
  if (!feed.url) throw new TypeError("RSS feed URL is required");
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-rss-upsert");
  const member = RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(
      context,
      transactionId,
      0,
      1,
      feed.url,
      createdAtMs,
      { feed: feed as unknown as LibraryCoreCanonicalValue },
    ),
    { digest },
  );
  await commitFollowerTransaction(context, [member]);
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
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-preferences");
  const member =
    PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      transactionMemberInput(
        context,
        transactionId,
        0,
        1,
        "preferences",
        createdAtMs,
        { updates: updates as unknown as LibraryCoreCanonicalValue },
      ),
      { digest },
    );
  await commitFollowerTransaction(context, [member]);
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
  const members = persons.map((person, index) =>
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
  await commitFollowerTransaction(context, members);
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
    left.id.localeCompare(right.id),
  );
  if (
    new Set(sortedAccounts.map((account) => account.id)).size !==
    sortedAccounts.length
  ) {
    throw new TypeError("Friend Account window contains duplicate IDs");
  }
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-friend-replace");
  const member = FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(
      context,
      transactionId,
      0,
      1,
      person.id,
      createdAtMs,
      {
        accounts: sortedAccounts as unknown as LibraryCoreCanonicalValue,
        person: person as unknown as LibraryCoreCanonicalValue,
      },
    ) satisfies FriendReplaceTransactionMemberInputV1,
    { digest },
  );
  await commitFollowerTransaction(context, [member]);
}

export async function commitPwaLibraryCorePersonRemove(
  personId: string,
  removedAtMs: number,
): Promise<void> {
  if (!personId) throw new TypeError("Person ID is required");
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-person-remove");
  const member = PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(
      context,
      transactionId,
      0,
      1,
      personId,
      removedAtMs,
      { removed_at_ms: removedAtMs },
    ),
    { digest },
  );
  await commitFollowerTransaction(context, [member]);
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
  const members = accounts.map((account, index) =>
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
  await commitFollowerTransaction(context, members);
}

export async function commitPwaLibraryCoreAccountRemove(
  accountId: string,
  removedAtMs: number,
): Promise<void> {
  if (!accountId) throw new TypeError("Account ID is required");
  const context = await readPwaFollowerMutationContext();
  const transactionId = transactionIdentity("pwa-account-remove");
  const member = ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
    transactionMemberInput(
      context,
      transactionId,
      0,
      1,
      accountId,
      removedAtMs,
      { removed_at_ms: removedAtMs },
    ),
    { digest },
  );
  await commitFollowerTransaction(context, [member]);
}
