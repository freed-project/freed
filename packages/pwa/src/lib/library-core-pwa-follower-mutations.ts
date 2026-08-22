import {
  assembleLibraryCoreTransactionV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  finalizeLibraryCoreTransactionV1,
  sha256LowerHex,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type FeedItemUserStateAssignmentFieldV1,
  type FeedItemUserStateAssignmentTransactionMemberInputV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerMutationContextV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "@freed/shared/library-core";
import { signPwaLibraryCoreFollowerOperation } from "./library-core-browser-key-vault";
import {
  commitPwaFollowerIntent,
  readPwaFollowerMutationContext,
} from "./library-core-sqlite-runtime";

const MAXIMUM_ASSIGNMENT_MEMBERS = 1_000;

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
    throw new Error("PWA follower intent receipt does not match its transaction");
  }
  return receipt;
}

function transactionIdentity(prefix: string): LibraryCoreOperationInstanceId {
  return `${prefix}:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
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
