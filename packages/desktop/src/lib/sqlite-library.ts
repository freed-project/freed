/**
 * SQLite-only Freed Desktop Library runtime.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  buildDiscoveredAccountsFromItems,
  createDefaultPreferences,
  hasSampleDataFingerprint,
  sanitizeAccountWrite,
  sanitizePersonWrite,
  sanitizeRssFeedWrite,
  stripDeviceLocalPreferenceUpdates,
  type Account,
  type FeedItem,
  type Person,
  type ReachOutLog,
  type RssFeed,
  type UserPreferences,
} from "@freed/shared";
import {
  ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  assembleLibraryCoreTransactionV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreFractionalNumbersV1,
  encodeLibraryCoreOperationSignatureInput,
  digestLibraryCoreRssFeedScopeActionRequestV1,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_SYNC_RECEIPT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SEEN_SYNC_RECEIPT_TRANSACTION_MEMBER_SCHEMA,
  finalizeLibraryCoreTransactionV1,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID,
  LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION,
  LIBRARY_CORE_PERSON_DETAIL_QUERY_ID,
  LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION,
  LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
  LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
  PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  parseLibraryCoreNormalizedCheckpointExportPageV2,
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointActivationReceiptV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  parseLibraryCoreNormalizedCheckpointStageStatusV2,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  readLibraryCoreNormalizedPreferencesV1,
  scanLibraryCoreNormalizedBackgroundItemsV1,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  readLibraryCoreNormalizedItemDetailV1,
  sha256LowerHex,
  type AccountRemoveTransactionMemberInputV1,
  type AccountUpsertTransactionMemberInputV1,
  type FeedItemCaptureUpsertTransactionMemberInputV1,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type FeedItemRemoveTransactionMemberInputV1,
  type FeedItemSyncReceiptTransactionMemberInputV1,
  type FeedItemUserStateAssignmentFieldV1,
  type FeedItemUserStateAssignmentTransactionMemberInputV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedCheckpointCursorV2,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointExportPageV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreOperationInstanceId,
  type LibraryCoreRssFeedScopeActionKindV1,
  type LibraryCoreScopeActionStagePageV1,
  type PersonRemoveTransactionMemberInputV1,
  type PersonUpsertTransactionMemberInputV1,
  type PreferencesLeafAssignmentTransactionMemberInputV1,
  type RssFeedRemoveTransactionMemberInputV1,
  type RssFeedTitleAssignmentTransactionMemberInputV1,
  type RssFeedUpsertTransactionMemberInputV1,
} from "@freed/shared/library-core";
import type { LibraryCoreAcceptedAuthorityStateV1 } from "@freed/shared/library-core";
import type { DocChangeEvent, DocState, WorkerRequest } from "./library-types";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { mergeSqliteFeedItem } from "./sqlite-feed-item-merge";

export interface SqliteStatus {
  active: boolean;
  revision: number;
  expectedItemCount: number;
  importedItemCount: number;
  sourceGeneration: number;
  sourceRevision: number;
  sourceDigest: string;
}

export type SqliteLibraryAcceptedAuthority =
  LibraryCoreAcceptedAuthorityStateV1;

export interface SqliteLibraryActorEnrollment {
  readonly actor_id: string;
  readonly actor_public_key: string;
  readonly enrollment_operation_id: string;
  readonly enrollment_certificate_digest: string;
  readonly canonical_enrollment_certificate_json: string;
  readonly actor_chain_genesis: string;
}

export interface SqliteLibraryPersistedCloudIdentity {
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly writerId: string;
}

export interface NormalizedLibraryCloudIdentity
  extends LibraryCoreNormalizedCheckpointExportDescriptorV2 {
  readonly localActorId: string;
}

export interface NormalizedLibraryWriterEpochReassignment {
  readonly authority: SqliteLibraryAcceptedAuthority;
  readonly canonicalEpochCertificateJson: string;
}

export interface SqliteLibraryActorCheckpointState {
  readonly actor_id: string;
  readonly accepted_sequence: number;
  readonly accepted_operation_id: string | null;
  readonly accepted_chain_digest: string;
  readonly enrollment_certificate_digest: string;
  readonly retired: false;
  readonly retirement_certificate_digest: null;
  readonly canonical_enrollment_certificate_json: string;
}

export interface SqliteLibraryIntentResultOutboxEntry {
  readonly resultOperationId: string;
  readonly actorId: string;
  readonly resultSequence: number;
  readonly intentOperationId: string;
  readonly intentSequence: number;
  readonly status: "accepted" | "provider_completed" | "provider_failed";
  readonly providerReceiptDigest: string | null;
  readonly enqueuedAtMs: number;
}

export interface SqliteLibraryCloudWriterAdmissionStatus {
  readonly configured: boolean;
  readonly allowed: boolean;
  readonly localWriterId: string | null;
  readonly activeWriterId: string | null;
  readonly storageEpoch: string | null;
  readonly controlRevision: string | null;
  readonly verifiedAtMs: number | null;
}

export interface NormalizedLibraryFollowerRuntimeStatus {
  readonly state:
    | "awaiting_checkpoint"
    | "awaiting_enrollment"
    | "enrollment_pending"
    | "active";
  readonly libraryId: string | null;
  readonly authorityEpochId: string | null;
  readonly actorId: string | null;
  readonly checkpointGeneration: number | null;
  readonly sourceRevision: number | null;
  readonly pendingIntentCount: number;
  readonly publishedIntentCount: number;
  readonly importedResultCount: number;
}


export interface SqliteLibraryFollowerOperationSignature {
  readonly actorId: string;
  readonly operationSigningBodyDigest: string;
  readonly signature: string;
}

export interface SqliteLibraryPrimaryMutationContext {
  readonly libraryId: string;
  readonly epoch: number;
  readonly epochId: string;
  readonly actorId: string;
  readonly actorPublicKey: string;
  readonly nextCounter: number;
  readonly previousOperationId: string | null;
  readonly previousChainDigest: string;
  readonly observedFrontier: readonly Readonly<{
    readonly actorId: string;
    readonly sequence: number;
    readonly operationId: string;
    readonly chainDigest: string;
  }>[];
}

export interface SqliteLibraryNormalizedFollowerIntentReceipt {
  readonly transactionId: string;
  readonly actorId: string;
  readonly firstCounter: number;
  readonly lastCounter: number;
  readonly memberCount: number;
  readonly optimisticFieldCount: number;
  readonly state: "pending";
}

export interface SqliteLibraryNormalizedMutationReceipt {
  readonly transactionId: string;
  readonly transactionDigest: string;
  readonly actorId: string;
  readonly memberCount: number;
  readonly firstCounter: number;
  readonly lastCounter: number;
  readonly committedOperationId: string;
  readonly committedChainDigest: string;
  readonly previousRevision: number;
  readonly committedRevision: number;
  readonly committedAt: number;
  readonly followerResultDigest: string;
  readonly followerResultSequence: number;
  readonly canonicalFollowerResultJson: string;
  readonly invalidations: readonly Readonly<{
    readonly ordinal: number;
    readonly topic: string;
    readonly entityId: string | null;
    readonly resetRequired: boolean;
  }>[];
}

export interface NormalizedLibraryFollowerActorRequest {
  readonly libraryId: string;
  readonly authorityEpochId: string;
  readonly actorId: string;
  readonly actorPublicKey: string;
  readonly enrollmentRequestDigest: string;
  readonly canonicalEnrollmentRequestJson: string;
  readonly createdAt: number;
}

export interface NormalizedLibraryFollowerActorEnrollment {
  readonly libraryId: string;
  readonly authorityEpochId: string;
  readonly actorId: string;
  readonly actorPublicKey: string;
  readonly enrollmentCertificateDigest: string;
  readonly canonicalEnrollmentCertificateJson: string;
  readonly actorChainGenesis: string;
  readonly enrolledAt: number;
}

export interface SqliteLibraryFollowerIntentOutboxCandidate {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
  readonly schemaVersion: number;
  readonly firstIntentSequence: number;
  readonly lastIntentSequence: number;
  readonly previousSegmentDigest: string | null;
  readonly canonicalEnvelopeBytes: number;
  readonly transactionCount: number;
  readonly entries: readonly Readonly<{
    operationId: string;
    intentSequence: number;
    canonicalEnvelopeJson: string;
  }>[];
}

export interface SqliteLibraryFollowerIntentPublicationReceipt {
  readonly firstIntentSequence: number;
  readonly lastIntentSequence: number;
  readonly operationCount: number;
  readonly publishedSegmentDigest: string;
  readonly status: "recorded" | "already_recorded";
}

export interface SqliteLibraryFollowerResultImportCursor {
  readonly nextResultSequence: number;
  readonly latestSegmentDigest: string | null;
}

export interface SqliteLibraryFollowerResultImportReceipt {
  readonly firstResultSequence: number;
  readonly lastResultSequence: number;
  readonly resultCount: number;
  readonly segmentDigest: string;
  readonly status: "imported" | "already_imported";
}

export async function prepareNormalizedLibraryFollowerActorRequest(): Promise<NormalizedLibraryFollowerActorRequest> {
  return invoke<NormalizedLibraryFollowerActorRequest>(
    "prepare_normalized_library_follower_actor_request",
    { createdAt: Date.now() },
  );
}

export async function installNormalizedLibraryFollowerActorEnrollment(
  canonicalEnrollmentCertificateJson: string,
): Promise<NormalizedLibraryFollowerActorEnrollment> {
  return invoke<NormalizedLibraryFollowerActorEnrollment>(
    "install_normalized_library_follower_actor_enrollment",
    { canonicalEnrollmentCertificateJson },
  );
}

export async function readSqliteLibraryFollowerIntentOutboxCandidate(): Promise<SqliteLibraryFollowerIntentOutboxCandidate | null> {
  return invoke<SqliteLibraryFollowerIntentOutboxCandidate | null>(
    "read_sqlite_library_follower_intent_outbox_candidate",
    {
      request: {
        maximumOperations: 1_000,
        maximumCanonicalEnvelopeBytes: 4_194_304,
      },
    },
  );
}

export async function recordSqliteLibraryFollowerIntentPublication(input: {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
  readonly firstIntentSequence: number;
  readonly lastIntentSequence: number;
  readonly previousSegmentDigest: string | null;
  readonly publishedSegmentDigest: string;
}): Promise<SqliteLibraryFollowerIntentPublicationReceipt> {
  return invoke<SqliteLibraryFollowerIntentPublicationReceipt>(
    "record_sqlite_library_follower_intent_publication",
    { request: input },
  );
}

export async function readSqliteLibraryFollowerResultImportCursor(input: {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
}): Promise<SqliteLibraryFollowerResultImportCursor | null> {
  return invoke<SqliteLibraryFollowerResultImportCursor | null>(
    "read_sqlite_library_follower_result_import_cursor",
    { request: input },
  );
}

export async function appendSqliteLibraryFollowerResultSegment(input: {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
  readonly firstResultSequence: number;
  readonly lastResultSequence: number;
  readonly previousSegmentDigest: string | null;
  readonly segmentDigest: string;
  readonly entries: readonly Readonly<{
    readonly resultOperationId: string;
    readonly resultSequence: number;
    readonly intentOperationId: string;
    readonly intentSequence: number;
    readonly status: "accepted" | "provider_completed" | "provider_failed";
    readonly providerReceiptDigest: string | null;
  }>[];
}): Promise<SqliteLibraryFollowerResultImportReceipt> {
  return invoke<SqliteLibraryFollowerResultImportReceipt>(
    "append_sqlite_library_follower_result_segment",
    {
      request: {
        ...input,
        entries: [...input.entries],
        importedAtMs: Date.now(),
      },
    },
  );
}

export async function readNormalizedLibraryFollowerRuntimeStatus(): Promise<NormalizedLibraryFollowerRuntimeStatus> {
  return invoke<NormalizedLibraryFollowerRuntimeStatus>(
    "normalized_library_follower_runtime_status",
  );
}

export async function readNormalizedLibraryFollowerMutationContext(): Promise<SqliteLibraryPrimaryMutationContext | null> {
  return invoke<SqliteLibraryPrimaryMutationContext | null>(
    "normalized_library_follower_mutation_context",
  );
}

export async function signNormalizedLibraryFollowerOperation(input: {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
  readonly actorPublicKey: string;
  readonly operationSigningBodyDigest: string;
}): Promise<SqliteLibraryFollowerOperationSignature> {
  return invoke<SqliteLibraryFollowerOperationSignature>(
    "sign_normalized_library_follower_operation",
    { request: input },
  );
}

export async function enqueueNormalizedLibraryFollowerIntent(
  canonicalEnvelopeJson: readonly string[],
): Promise<SqliteLibraryNormalizedFollowerIntentReceipt> {
  if (
    canonicalEnvelopeJson.length === 0 ||
    canonicalEnvelopeJson.length > 1_000
  ) {
    throw new RangeError(
      "Normalized follower intent transaction has an invalid member count",
    );
  }
  return invoke<SqliteLibraryNormalizedFollowerIntentReceipt>(
    "enqueue_normalized_library_follower_intent",
    {
      request: {
        canonicalEnvelopeJson: [...canonicalEnvelopeJson],
        enqueuedAtMs: Date.now(),
      },
    },
  );
}

function operationDigest(
  domain: Parameters<typeof encodeLibraryCoreDigestInput>[0],
  value: unknown,
): string {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
  );
}

type SqliteLibraryMutationContext = Readonly<{
  mode: "primary" | "follower";
  libraryId: string;
  epoch: number;
  epochId: string;
  actorId: string;
  actorPublicKey: string;
  nextSequence: number;
  previousOperationId: string | null;
  previousChainDigest: string;
  observedFrontier: readonly Readonly<{
    actor_id: string;
    sequence: number;
    operation_id: string;
    chain_digest: string;
  }>[];
}>;

async function primaryMutationContext(): Promise<SqliteLibraryMutationContext | null> {
  let context: SqliteLibraryPrimaryMutationContext | null;
  try {
    context = await invoke<SqliteLibraryPrimaryMutationContext | null>(
      "normalized_library_primary_mutation_context",
    );
  } catch (error) {
    if (
      String(error).includes(
        "normalized Primary mutation context is unavailable",
      ) ||
      String(error).includes("normalized SQLite authority is not selected") ||
      String(error).includes(
        "normalized SQLite authority selection is unavailable on this host",
      )
    ) {
      return null;
    }
    throw error;
  }
  if (!context) return null;
  return {
    mode: "primary",
    libraryId: context.libraryId,
    epoch: context.epoch,
    epochId: context.epochId,
    actorId: context.actorId,
    actorPublicKey: context.actorPublicKey,
    nextSequence: context.nextCounter,
    previousOperationId: context.previousOperationId,
    previousChainDigest: context.previousChainDigest,
    observedFrontier: context.observedFrontier.map((tip) => ({
      actor_id: tip.actorId,
      sequence: tip.sequence,
      operation_id: tip.operationId,
      chain_digest: tip.chainDigest,
    })),
  };
}

async function mutationContext(
  allowPrimary = true,
): Promise<SqliteLibraryMutationContext | null> {
  if (allowPrimary) {
    const primary = await primaryMutationContext();
    if (primary) return primary;
  }
  let follower: SqliteLibraryPrimaryMutationContext | null;
  try {
    follower = await readNormalizedLibraryFollowerMutationContext();
  } catch (error) {
    if (
      String(error).includes("normalized follower actor is not active") ||
      String(error).includes("normalized SQLite authority is not selected") ||
      String(error).includes(
        "normalized SQLite authority selection is unavailable on this host",
      )
    ) {
      return null;
    }
    throw error;
  }
  if (!follower) return null;
  return {
    mode: "follower",
    libraryId: follower.libraryId,
    epoch: follower.epoch,
    epochId: follower.epochId,
    actorId: follower.actorId,
    actorPublicKey: follower.actorPublicKey,
    nextSequence: follower.nextCounter,
    previousOperationId: follower.previousOperationId,
    previousChainDigest: follower.previousChainDigest,
    observedFrontier: follower.observedFrontier.map((tip) => ({
      actor_id: tip.actorId,
      sequence: tip.sequence,
      operation_id: tip.operationId,
      chain_digest: tip.chainDigest,
    })),
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

async function finalizeAndSubmitTransaction(
  context: SqliteLibraryMutationContext,
  members: Parameters<typeof assembleLibraryCoreTransactionV1>[0],
  committedAtMs: number,
): Promise<void> {
  const assembled = assembleLibraryCoreTransactionV1(
    members,
    context.previousChainDigest as LibraryCoreLowercaseHex64,
    { digest: operationDigest },
  );
  let signatureIndex = 0;
  const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
    digest: operationDigest,
    signOperation: async (message) => {
      const member = assembled.members[signatureIndex++];
      if (!member) throw new Error("Follower signer received too many members");
      const expected = encodeLibraryCoreOperationSignatureInput({
        operation_signing_body_digest: member.signing_body_digest,
      });
      if (!sameBytes(message, expected)) {
        throw new Error(
          "Follower signer input does not match its assembled member",
        );
      }
      const signed =
        context.mode === "primary"
          ? await invoke<SqliteLibraryFollowerOperationSignature>(
              "sign_normalized_library_operation",
              {
                request: {
                  libraryId: context.libraryId,
                  epochId: context.epochId,
                  actorId: context.actorId,
                  actorPublicKey: context.actorPublicKey,
                  operationSigningBodyDigest: member.signing_body_digest,
                },
              },
            )
          : await signNormalizedLibraryFollowerOperation({
              libraryId: context.libraryId,
              epochId: context.epochId,
              actorId: context.actorId,
              actorPublicKey: context.actorPublicKey,
              operationSigningBodyDigest: member.signing_body_digest,
            });
      if (
        signed.actorId !== context.actorId ||
        signed.operationSigningBodyDigest !== member.signing_body_digest
      ) {
        throw new Error("Follower signer returned a mismatched receipt");
      }
      return signed.signature as LibraryCoreEd25519SignatureHex;
    },
  });
  if (signatureIndex !== assembled.members.length) {
    throw new Error("Library signer did not sign every transaction member");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const canonicalEnvelopeJson = finalized.members.map((member) =>
    decoder.decode(
      encodeLibraryCoreCanonicalValue(
        member.envelope as unknown as LibraryCoreCanonicalValue,
      ),
    ),
  );
  if (context.mode === "follower") {
    await enqueueNormalizedLibraryFollowerIntent(canonicalEnvelopeJson);
    return;
  }
  const receipt = await invoke<SqliteLibraryNormalizedMutationReceipt>(
    "commit_normalized_library_transaction",
    {
      request: {
        libraryId: context.libraryId,
        canonicalEnvelopeJson,
        committedAtMs,
      },
    },
  );
  if (
    receipt.transactionId !== finalized.transaction_body.transaction_id ||
    receipt.transactionDigest !== finalized.transaction_digest ||
    receipt.actorId !== context.actorId ||
    receipt.memberCount !== finalized.members.length
  ) {
    throw new Error(
      "Primary returned a mismatched normalized mutation receipt",
    );
  }
}

async function maybeSubmitReadAssignments(
  entityIds: readonly string[],
  readAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const uniqueIds = [...new Set(entityIds)];
  if (uniqueIds.length === 0) return true;
  for (let start = 0; start < uniqueIds.length; start += 1_000) {
    const batchContext = context;
    const batch = uniqueIds.slice(start, start + 1_000);
    const transactionId =
      `desktop-library-read:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((entityId, index) =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: readAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: entityId,
          payload: { read_at_ms: readAtMs },
          created_at_ms: readAtMs,
        } satisfies FeedItemReadAssignmentTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, readAtMs);
    if (start + batch.length < uniqueIds.length) {
      context = await mutationContext();
      if (!context)
        throw new Error("Library mutation context changed during read commit");
    }
  }
  return true;
}

async function maybeSubmitUserStateAssignments(
  assignments: readonly {
    readonly entityId: string;
    readonly field: FeedItemUserStateAssignmentFieldV1;
    readonly assigned: boolean;
    readonly assignedAtMs: number;
  }[],
): Promise<boolean> {
  const allowPrimary = assignments.every(({ field }) => field !== "liked");
  let context = await mutationContext(allowPrimary);
  if (!context) return false;
  if (assignments.length === 0) return true;
  for (let start = 0; start < assignments.length; start += 1_000) {
    const batchContext = context;
    const batch = assignments.slice(start, start + 1_000);
    const transactionId =
      `desktop-library-assignment:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((assignment, index) => {
      const schema =
        assignment.field === "saved"
          ? FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
          : assignment.field === "archived"
            ? FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
            : FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA;
      return schema.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: assignment.assignedAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: assignment.entityId,
          payload: {
            assigned: assignment.assigned,
            assigned_at_ms: assignment.assignedAtMs,
          },
          created_at_ms: assignment.assignedAtMs,
        } satisfies FeedItemUserStateAssignmentTransactionMemberInputV1,
        { digest: operationDigest },
      );
    });
    const committedAtMs = batch.reduce(
      (latest, assignment) => Math.max(latest, assignment.assignedAtMs),
      0,
    );
    await finalizeAndSubmitTransaction(batchContext, members, committedAtMs);
    if (start + batch.length < assignments.length) {
      context = await mutationContext(allowPrimary);
      if (!context)
        throw new Error(
          "Library mutation context changed during assignment commit",
        );
    }
  }
  return true;
}

async function submitProviderSyncReceipt(
  operationType:
    | "feed_item_like_sync_receipt"
    | "feed_item_seen_sync_receipt",
  entityId: string,
  syncedAtMs: number,
): Promise<void> {
  const context = await primaryMutationContext();
  if (!context) {
    requireBrowserTestProjection("provider delivery receipt");
    await mutateItems(
      operationType === "feed_item_like_sync_receipt"
        ? "confirm_liked"
        : "confirm_seen",
      { ids: [entityId], timestampMs: syncedAtMs },
    );
    return;
  }
  const transactionId =
    `desktop-provider-receipt:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const input: FeedItemSyncReceiptTransactionMemberInputV1 = {
    operation_id: `${transactionId}:0`,
    library_id: context.libraryId,
    epoch: context.epoch,
    epoch_id: context.epochId,
    actor_id: context.actorId,
    actor_sequence: context.nextSequence,
    previous_actor_operation_id: context.previousOperationId,
    causal_frontier: context.observedFrontier,
    hlc_wall_ms: syncedAtMs,
    hlc_counter: 0,
    transaction_id: transactionId,
    transaction_member_index: 0,
    transaction_member_count: 1,
    entity_id: entityId,
    payload: { synced_at_ms: syncedAtMs },
    created_at_ms: syncedAtMs,
  };
  const schema =
    operationType === "feed_item_like_sync_receipt"
      ? FEED_ITEM_LIKE_SYNC_RECEIPT_TRANSACTION_MEMBER_SCHEMA
      : FEED_ITEM_SEEN_SYNC_RECEIPT_TRANSACTION_MEMBER_SCHEMA;
  await finalizeAndSubmitTransaction(
    context,
    [schema.construct(input, { digest: operationDigest })],
    syncedAtMs,
  );
}

const FOLLOWER_ENTITY_BATCH_LIMIT = 128;

function uniqueByIdentity<T>(
  values: readonly T[],
  identity: (value: T) => string,
): T[] {
  const unique = new Map<string, T>();
  for (const value of values) unique.set(identity(value), value);
  return [...unique.values()];
}

function synchronizedRssFeed(
  feed: RssFeed,
): Record<string, LibraryCoreCanonicalValue> {
  return sanitizeRssFeedWrite(feed) as unknown as Record<
    string,
    LibraryCoreCanonicalValue
  >;
}

async function maybeSubmitFeedItemCaptures(
  input: readonly FeedItem[],
  createdAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const items = uniqueByIdentity(input, (item) => item.globalId);
  if (items.length === 0) return true;
  for (
    let start = 0;
    start < items.length;
    start += FOLLOWER_ENTITY_BATCH_LIMIT
  ) {
    const batchContext = context;
    const batch = items.slice(start, start + FOLLOWER_ENTITY_BATCH_LIMIT);
    const transactionId =
      `desktop-library-capture:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((item, index) =>
      FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: createdAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: item.globalId,
          payload: {
            item: encodeLibraryCoreFractionalNumbersV1(item) as Record<
              string,
              LibraryCoreCanonicalValue
            >,
          },
          created_at_ms: createdAtMs,
        } satisfies FeedItemCaptureUpsertTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, createdAtMs);
    if (start + batch.length < items.length) {
      context = await mutationContext();
      if (!context)
        throw new Error(
          "Library mutation context changed during capture commit",
        );
    }
  }
  return true;
}

async function maybeSubmitFeedItemRemoves(
  entityIds: readonly string[],
  removedAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const uniqueIds = [...new Set(entityIds)];
  if (uniqueIds.length === 0) return true;
  for (
    let start = 0;
    start < uniqueIds.length;
    start += FOLLOWER_ENTITY_BATCH_LIMIT
  ) {
    const batchContext = context;
    const batch = uniqueIds.slice(start, start + FOLLOWER_ENTITY_BATCH_LIMIT);
    const transactionId =
      `desktop-library-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((entityId, index) =>
      FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: removedAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: entityId,
          payload: { removed_at_ms: removedAtMs },
          created_at_ms: removedAtMs,
        } satisfies FeedItemRemoveTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, removedAtMs);
    if (start + batch.length < uniqueIds.length) {
      context = await mutationContext();
      if (!context)
        throw new Error(
          "Library mutation context changed during removal commit",
        );
    }
  }
  return true;
}

async function maybeSubmitRssFeedUpsert(
  feed: RssFeed,
  createdAtMs: number,
): Promise<boolean> {
  const context = await mutationContext();
  if (!context) return false;
  const transactionId =
    `desktop-library-rss-upsert:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const member = RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
    {
      operation_id: `${transactionId}:0`,
      library_id: context.libraryId,
      epoch: context.epoch,
      epoch_id: context.epochId,
      actor_id: context.actorId,
      actor_sequence: context.nextSequence,
      previous_actor_operation_id: context.previousOperationId,
      causal_frontier: context.observedFrontier,
      hlc_wall_ms: createdAtMs,
      hlc_counter: 0,
      transaction_id: transactionId,
      transaction_member_index: 0,
      transaction_member_count: 1,
      entity_id: feed.url,
      payload: {
        feed: synchronizedRssFeed(feed),
      },
      created_at_ms: createdAtMs,
    } satisfies RssFeedUpsertTransactionMemberInputV1,
    { digest: operationDigest },
  );
  await finalizeAndSubmitTransaction(context, [member], createdAtMs);
  return true;
}

async function maybeSubmitRssFeedRemove(input: {
  readonly includeItems: boolean;
  readonly removedAtMs: number;
  readonly url: string;
}): Promise<boolean> {
  return maybeSubmitRssFeedRemoves(
    [input.url],
    input.includeItems,
    input.removedAtMs,
  );
}

async function maybeSubmitRssFeedRemoves(
  urls: readonly string[],
  includeItems: boolean,
  removedAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const uniqueUrls = [...new Set(urls)];
  if (uniqueUrls.length === 0) return true;
  const schema = includeItems
    ? RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA
    : RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA;
  for (
    let start = 0;
    start < uniqueUrls.length;
    start += FOLLOWER_ENTITY_BATCH_LIMIT
  ) {
    const batchContext = context;
    const batch = uniqueUrls.slice(start, start + FOLLOWER_ENTITY_BATCH_LIMIT);
    const transactionId =
      `desktop-library-rss-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((url, index) =>
      schema.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: removedAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: url,
          payload: { removed_at_ms: removedAtMs },
          created_at_ms: removedAtMs,
        } satisfies RssFeedRemoveTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, removedAtMs);
    if (start + batch.length < uniqueUrls.length) {
      context = await mutationContext();
      if (!context)
        throw new Error(
          "Library mutation context changed during RSS Feed removal",
        );
    }
  }
  return true;
}

async function maybeSubmitRssFeedTitleAssignments(
  assignments: readonly Readonly<{ readonly title: string; readonly url: string }>[],
  assignedAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const uniqueAssignments = uniqueByIdentity(assignments, (entry) => entry.url);
  if (uniqueAssignments.length === 0) return true;
  for (
    let start = 0;
    start < uniqueAssignments.length;
    start += FOLLOWER_ENTITY_BATCH_LIMIT
  ) {
    const batchContext = context;
    const batch = uniqueAssignments.slice(
      start,
      start + FOLLOWER_ENTITY_BATCH_LIMIT,
    );
    const transactionId =
      `desktop-library-rss-title:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((assignment, index) =>
      RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: assignedAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: assignment.url,
          payload: {
            assigned_at_ms: assignedAtMs,
            title: assignment.title,
          },
          created_at_ms: assignedAtMs,
        } satisfies RssFeedTitleAssignmentTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, assignedAtMs);
    if (start + batch.length < uniqueAssignments.length) {
      context = await mutationContext();
      if (!context)
        throw new Error(
          "Library mutation context changed during RSS Feed title repair",
        );
    }
  }
  return true;
}

async function executeFrozenRssFeedScope(
  action: LibraryCoreRssFeedScopeActionKindV1,
  createdAt: number,
  commit: (urls: readonly string[]) => Promise<void>,
): Promise<number> {
  const request = { action, schemaVersion: 1 as const };
  const stageId = `rss-feed-scope:${crypto.randomUUID()}`;
  const freezeRequest = {
    actionKind: action,
    createdAt,
    requestDigest: digestLibraryCoreRssFeedScopeActionRequestV1(request),
    stageId,
  };
  try {
    try {
      await invoke("freeze_normalized_rss_feed_scope", freezeRequest);
    } catch {
      await invoke("freeze_normalized_rss_feed_scope", freezeRequest);
    }
    let afterOrdinal = -1;
    let affectedCount = 0;
    for (;;) {
      const page = await invoke<LibraryCoreScopeActionStagePageV1>(
        "page_normalized_scope_action",
        { afterOrdinal, stageId },
      );
      if (page.entityIds.length === 0) return affectedCount;
      await commit(page.entityIds);
      affectedCount += page.entityIds.length;
      if (page.nextOrdinal <= afterOrdinal) {
        throw new Error("RSS Feed scope page did not advance");
      }
      afterOrdinal = page.nextOrdinal;
    }
  } finally {
    await invoke("close_normalized_scope_action", { stageId });
  }
}

function repairedRssFeedTitle(url: string): string | null {
  try {
    return (
      new URL(url).hostname.replace(/^(?:www|feeds?)\./, "").trim() || null
    );
  } catch {
    return null;
  }
}

async function maybeSubmitPreferences(
  updates: Partial<UserPreferences>,
  createdAtMs: number,
): Promise<boolean> {
  const context = await mutationContext();
  if (!context) return false;
  const synchronized = stripDeviceLocalPreferenceUpdates(updates);
  if (Object.keys(synchronized).length === 0) return true;
  const transactionId =
    `desktop-library-preferences:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const member =
    PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        operation_id: `${transactionId}:0`,
        library_id: context.libraryId,
        epoch: context.epoch,
        epoch_id: context.epochId,
        actor_id: context.actorId,
        actor_sequence: context.nextSequence,
        previous_actor_operation_id: context.previousOperationId,
        causal_frontier: context.observedFrontier,
        hlc_wall_ms: createdAtMs,
        hlc_counter: 0,
        transaction_id: transactionId,
        transaction_member_index: 0,
        transaction_member_count: 1,
        entity_id: "preferences",
        payload: {
          updates: synchronized as unknown as Record<
            string,
            LibraryCoreCanonicalValue
          >,
        },
        created_at_ms: createdAtMs,
      } satisfies PreferencesLeafAssignmentTransactionMemberInputV1,
      { digest: operationDigest },
    );
  await finalizeAndSubmitTransaction(context, [member], createdAtMs);
  return true;
}

async function maybeSubmitPersonUpserts(
  input: readonly Person[],
  createdAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const persons = uniqueByIdentity(input, (person) => person.id);
  if (persons.length === 0) return true;
  for (
    let start = 0;
    start < persons.length;
    start += FOLLOWER_ENTITY_BATCH_LIMIT
  ) {
    const batchContext = context;
    const batch = persons.slice(start, start + FOLLOWER_ENTITY_BATCH_LIMIT);
    const transactionId =
      `desktop-library-person-upsert:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((person, index) =>
      PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: createdAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: person.id,
          payload: {
            person: sanitizePersonWrite(person) as unknown as Record<
              string,
              LibraryCoreCanonicalValue
            >,
          },
          created_at_ms: createdAtMs,
        } satisfies PersonUpsertTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, createdAtMs);
    if (start + batch.length < persons.length) {
      context = await mutationContext();
      if (!context)
        throw new Error(
          "Library mutation context changed during Person commit",
        );
    }
  }
  return true;
}

async function maybeSubmitPersonRemove(
  personId: string,
  removedAtMs: number,
): Promise<boolean> {
  const context = await mutationContext();
  if (!context) return false;
  const transactionId =
    `desktop-library-person-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const member = PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA.construct(
    {
      operation_id: `${transactionId}:0`,
      library_id: context.libraryId,
      epoch: context.epoch,
      epoch_id: context.epochId,
      actor_id: context.actorId,
      actor_sequence: context.nextSequence,
      previous_actor_operation_id: context.previousOperationId,
      causal_frontier: context.observedFrontier,
      hlc_wall_ms: removedAtMs,
      hlc_counter: 0,
      transaction_id: transactionId,
      transaction_member_index: 0,
      transaction_member_count: 1,
      entity_id: personId,
      payload: { removed_at_ms: removedAtMs },
      created_at_ms: removedAtMs,
    } satisfies PersonRemoveTransactionMemberInputV1,
    { digest: operationDigest },
  );
  await finalizeAndSubmitTransaction(context, [member], removedAtMs);
  return true;
}

async function maybeSubmitAccountUpserts(
  input: readonly Account[],
  createdAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const accounts = uniqueByIdentity(input, (account) => account.id);
  if (accounts.length === 0) return true;
  for (
    let start = 0;
    start < accounts.length;
    start += FOLLOWER_ENTITY_BATCH_LIMIT
  ) {
    const batchContext = context;
    const batch = accounts.slice(start, start + FOLLOWER_ENTITY_BATCH_LIMIT);
    const transactionId =
      `desktop-library-account-upsert:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((account, index) =>
      ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: batchContext.libraryId,
          epoch: batchContext.epoch,
          epoch_id: batchContext.epochId,
          actor_id: batchContext.actorId,
          actor_sequence: batchContext.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? batchContext.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: batchContext.observedFrontier,
          hlc_wall_ms: createdAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: batch.length,
          entity_id: account.id,
          payload: {
            account: sanitizeAccountWrite(account) as unknown as Record<
              string,
              LibraryCoreCanonicalValue
            >,
          },
          created_at_ms: createdAtMs,
        } satisfies AccountUpsertTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, createdAtMs);
    if (start + batch.length < accounts.length) {
      context = await mutationContext();
      if (!context)
        throw new Error(
          "Library mutation context changed during Account commit",
        );
    }
  }
  return true;
}

async function maybeSubmitAccountRemove(
  accountId: string,
  removedAtMs: number,
): Promise<boolean> {
  const context = await mutationContext();
  if (!context) return false;
  const transactionId =
    `desktop-library-account-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const member = ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
    {
      operation_id: `${transactionId}:0`,
      library_id: context.libraryId,
      epoch: context.epoch,
      epoch_id: context.epochId,
      actor_id: context.actorId,
      actor_sequence: context.nextSequence,
      previous_actor_operation_id: context.previousOperationId,
      causal_frontier: context.observedFrontier,
      hlc_wall_ms: removedAtMs,
      hlc_counter: 0,
      transaction_id: transactionId,
      transaction_member_index: 0,
      transaction_member_count: 1,
      entity_id: accountId,
      payload: { removed_at_ms: removedAtMs },
      created_at_ms: removedAtMs,
    } satisfies AccountRemoveTransactionMemberInputV1,
    { digest: operationDigest },
  );
  await finalizeAndSubmitTransaction(context, [member], removedAtMs);
  return true;
}

export async function setSqliteLibraryCloudWriterAdmission(input: {
  readonly localWriterId: string;
  readonly activeWriterId: string;
  readonly storageEpoch: string;
  readonly controlRevision: string;
}): Promise<SqliteLibraryCloudWriterAdmissionStatus> {
  return invoke<SqliteLibraryCloudWriterAdmissionStatus>(
    "set_sqlite_library_cloud_writer_admission",
    { request: { ...input, verifiedAtMs: Date.now() } },
  );
}

export async function sqliteLibraryCloudWriterAdmissionStatus(): Promise<SqliteLibraryCloudWriterAdmissionStatus> {
  return invoke<SqliteLibraryCloudWriterAdmissionStatus>(
    "sqlite_library_cloud_writer_admission_status",
  );
}

export interface SqliteLibraryFacetSummary {
  archivedCount: number;
  sampleItemCount: number;
  savedArchivedCount: number;
  savedCount: number;
  savedPlatformCount: number;
  tags: string[];
  totalCount: number;
}

export async function readSqliteLibraryFacetSummary(): Promise<SqliteLibraryFacetSummary> {
  const summary = await invoke<SqliteLibraryFacetSummary>(
    "read_sqlite_library_facet_summary",
  );
  return {
    ...summary,
    tags: [...summary.tags].sort((left, right) => left.localeCompare(right)),
  };
}

export interface SqliteLibraryBackupSummary {
  backupId: string;
  fileName: string;
  createdAtMs: number;
  revision: number;
  itemCount: number;
  reason: "auto" | "manual";
  byteLength: number;
  sha256: string;
}

export interface SqliteLibraryBackupChunk {
  readonly backupId: string;
  readonly bytes: number[];
  readonly nextOffset: number | null;
  readonly offset: number;
  readonly sha256: string;
  readonly totalByteLength: number;
}

let sqliteActive = false;

export function isSqliteLibraryActive(): boolean {
  return sqliteActive;
}

function emptyShell(): Omit<DocState, "items"> {
  return {
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    desktopClientIds: [],
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
    docItemCount: 0,
  };
}

export async function sqliteLibraryStatus(): Promise<SqliteStatus | null> {
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") return null;
  const status = await invoke<SqliteStatus | null>("sqlite_library_status");
  sqliteActive = status?.active === true;
  return status;
}

export async function ensureFreshNormalizedDesktopLibrary(
  legacyDataAbsent: boolean,
): Promise<boolean> {
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") return false;
  return invoke<boolean>("ensure_fresh_normalized_desktop_library", {
    legacyDataAbsent,
  });
}

export async function describeNormalizedLibraryCheckpoint(): Promise<
  LibraryCoreNormalizedCheckpointExportDescriptorV2
> {
  return parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    await invoke<unknown>("describe_normalized_library_checkpoint"),
  );
}

export async function describeNormalizedLibraryCloudIdentity(): Promise<NormalizedLibraryCloudIdentity> {
  const installationWitness = await invoke<string>(
    "get_desktop_installation_witness",
  );
  if (!HEX_64.test(installationWitness)) {
    throw new TypeError(
      "Freed Desktop returned an invalid installation witness",
    );
  }
  const value = await invoke<unknown>(
    "describe_normalized_library_cloud_identity",
    { installationWitness },
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Freed Desktop returned an invalid cloud identity");
  }
  const { localActorId, ...checkpointValue } = value as Record<string, unknown>;
  if (typeof localActorId !== "string" || !HEX_64.test(localActorId)) {
    throw new TypeError("Freed Desktop returned an invalid local actor ID");
  }
  return Object.freeze({
    ...parseLibraryCoreNormalizedCheckpointExportDescriptorV2(checkpointValue),
    localActorId,
  });
}

export async function readNormalizedLibraryCheckpointPage(input: {
  readonly snapshot: LibraryCoreNormalizedCheckpointExportDescriptorV2;
  readonly after: LibraryCoreNormalizedCheckpointCursorV2 | null;
}): Promise<LibraryCoreNormalizedCheckpointExportPageV2> {
  return parseLibraryCoreNormalizedCheckpointExportPageV2(
    await invoke<unknown>("read_normalized_library_checkpoint_page", {
      request: {
        snapshot: input.snapshot,
        page: {
          after: input.after,
          maximumRecords: LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
          maximumResponseBytes:
            LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
        },
      },
    }),
  );
}

export async function beginNormalizedLibraryCheckpointImport(
  input: LibraryCoreBeginNormalizedCheckpointStageV2,
): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
  const request = parseLibraryCoreBeginNormalizedCheckpointStageV2(input);
  return parseLibraryCoreNormalizedCheckpointStageStatusV2(
    await invoke<unknown>("begin_normalized_library_checkpoint_import", {
      request,
    }),
  );
}

export async function appendNormalizedLibraryCheckpointImportPage(input: {
  readonly stageId: string;
  readonly records: readonly LibraryCoreNormalizedCheckpointRecordV2[];
}): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
  const request = parseLibraryCoreNormalizedCheckpointStagePageV2(input);
  return parseLibraryCoreNormalizedCheckpointStageStatusV2(
    await invoke<unknown>(
      "append_normalized_library_checkpoint_import_page",
      { request },
    ),
  );
}

export async function activateNormalizedLibraryCheckpointImport(
  input: Readonly<{
    stageId: string;
    followerReceipt?: Readonly<{
      checkpointGeneration: number;
      writerActorId: string;
      manifestObjectKey: string;
      manifestTransportObjectId: string;
      manifestContentDigest: string;
      controlRevision: string;
      installedAt: number;
    }>;
  }>,
): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2> {
  return parseLibraryCoreNormalizedCheckpointActivationReceiptV2(
    await invoke<unknown>("activate_normalized_library_checkpoint_import", {
      request: input,
    }),
  );
}

export async function reassignNormalizedLibraryWriterEpoch(input: {
  readonly canonicalSourceControlJson: string;
  readonly targetWriterId: string;
}): Promise<NormalizedLibraryWriterEpochReassignment> {
  if (!HEX_64.test(input.targetWriterId)) {
    throw new TypeError("normalized target writer ID is invalid");
  }
  const installationWitness = await invoke<string>(
    "get_desktop_installation_witness",
  );
  if (!HEX_64.test(installationWitness)) {
    throw new TypeError(
      "Freed Desktop returned an invalid installation witness",
    );
  }
  const reassignment = await invoke<NormalizedLibraryWriterEpochReassignment>(
    "reassign_normalized_library_writer_epoch",
    {
      request: {
        ...input,
        installationWitness,
        acceptedAtMs: Date.now(),
      },
    },
  );
  if (
    reassignment.authority.library_id.length !== 64 ||
    reassignment.authority.epoch_id.length !== 64 ||
    reassignment.canonicalEpochCertificateJson.length === 0
  ) {
    throw new TypeError("normalized writer reassignment receipt is invalid");
  }
  return Object.freeze(reassignment);
}

const HEX_64 = /^[a-f0-9]{64}$/;
/** Countersign and enroll one proof-only PWA actor request in native SQLite. */
export async function acceptPwaActorEnrollmentRequest(
  canonicalRequestBytes: Uint8Array,
): Promise<SqliteLibraryActorEnrollment> {
  if (
    canonicalRequestBytes.byteLength === 0 ||
    canonicalRequestBytes.byteLength > 65_536
  ) {
    throw new RangeError("PWA actor enrollment request has an invalid size");
  }
  return invoke<SqliteLibraryActorEnrollment>(
    "accept_pwa_actor_enrollment_request",
    {
      request: {
        canonicalRequestJson: new TextDecoder("utf-8", { fatal: true }).decode(
          canonicalRequestBytes,
        ),
      },
    },
  );
}

/** Admit one complete signed PWA intent transaction into SQLite. */
export async function acceptPwaIntentTransaction(
  canonicalEnvelopeJson: readonly string[],
): Promise<readonly SqliteLibraryIntentResultOutboxEntry[]> {
  if (
    canonicalEnvelopeJson.length === 0 ||
    canonicalEnvelopeJson.length > 1_000
  ) {
    throw new RangeError("PWA intent transaction has an invalid member count");
  }
  return invoke<SqliteLibraryIntentResultOutboxEntry[]>(
    "accept_pwa_intent_transaction",
    {
      request: {
        canonicalEnvelopeJson: [...canonicalEnvelopeJson],
        committedAtMs: Date.now(),
      },
    },
  );
}

export async function readPwaIntentResultOutbox(
  input: Readonly<{ libraryId: string; epochId: string }>,
  limit = 256,
): Promise<readonly SqliteLibraryIntentResultOutboxEntry[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
    throw new RangeError("PWA result outbox page limit is invalid");
  }
  return invoke<SqliteLibraryIntentResultOutboxEntry[]>(
    "read_pwa_intent_result_outbox",
    { request: { ...input, limit } },
  );
}

export async function acknowledgePwaIntentResultOutbox(
  resultOperationIds: readonly string[],
): Promise<void> {
  if (resultOperationIds.length < 1 || resultOperationIds.length > 256) {
    throw new RangeError("PWA result acknowledgement count is invalid");
  }
  return invoke("acknowledge_pwa_intent_result_outbox", {
    request: {
      resultOperationIds: [...resultOperationIds],
      acknowledgedAtMs: Date.now(),
    },
  });
}

export async function listSqliteLibraryActorEnrollments(input: {
  readonly libraryId: string;
  readonly epochId: string;
}): Promise<readonly SqliteLibraryActorCheckpointState[]> {
  return invoke<SqliteLibraryActorCheckpointState[]>(
    "list_sqlite_library_actor_enrollments",
    { request: input },
  );
}

export async function loadSqliteLibraryState(): Promise<DocState> {
  const [facets, preferences] = await Promise.all([
    queryNormalizedLibrary({
      queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
    }),
    readLibraryCoreNormalizedPreferencesV1(NORMALIZED_MUTATION_READER_RUNTIME),
  ]);
  sqliteActive = true;
  return {
    ...emptyShell(),
    items: [],
    preferences,
    searchCorpusVersion: facets.source.transitionSequence,
    totalItemCount: facets.summary.totalCount,
    totalArchivableCount: facets.summary.archivableCount,
    docItemCount: facets.summary.totalCount,
  };
}

function requireBrowserTestProjection(operation: string): void {
  if (import.meta.env.VITE_TEST_TAURI !== "1") {
    throw new Error(
      `Historical SQLite ${operation} is unavailable outside the browser test projection`,
    );
  }
}

async function upsertSqliteItems(items: readonly FeedItem[]): Promise<void> {
  if (items.length === 0) return;
  requireBrowserTestProjection("whole-item upsert");
  const captureItems = (
    window as unknown as {
      __FREED_E2E_NORMALIZED_CAPTURE_ITEMS__?: (
        items: readonly FeedItem[],
      ) => void;
    }
  ).__FREED_E2E_NORMALIZED_CAPTURE_ITEMS__;
  if (!captureItems) {
    throw new Error("Browser SQLite test capture bridge is unavailable");
  }
  captureItems(items);
}

export async function readSqliteItems(
  ids: readonly string[],
): Promise<FeedItem[]> {
  if (ids.length === 0) return [];
  const items = await Promise.all(
    ids.map((globalId) =>
      readLibraryCoreNormalizedItemDetailV1(
        NORMALIZED_MUTATION_READER_RUNTIME,
        globalId,
      ),
    ),
  );
  return items.filter((item): item is FeedItem => item !== null);
}

async function insertMissingSqliteItems(
  items: readonly FeedItem[],
): Promise<FeedItem[]> {
  if (items.length === 0) return [];
  const existing = new Set(
    (await readSqliteItems(items.map((item) => item.globalId))).map(
      (item) => item.globalId,
    ),
  );
  const missing = items.filter((item) => !existing.has(item.globalId));
  if (!(await maybeSubmitFeedItemCaptures(missing, Date.now()))) {
    await upsertSqliteItems(missing);
  }
  return missing;
}

async function mergeIncomingSqliteItems(
  items: readonly FeedItem[],
): Promise<FeedItem[]> {
  if (items.length === 0) return [];
  const existing = new Map(
    (await readSqliteItems(items.map((item) => item.globalId))).map(
      (item) => [item.globalId, item] as const,
    ),
  );
  const merged = items.map((incoming) => {
    const current = existing.get(incoming.globalId);
    if (!current) return incoming;
    return mergeSqliteFeedItem(current, incoming);
  });
  if (!(await maybeSubmitFeedItemCaptures(merged, Date.now()))) {
    await upsertSqliteItems(merged);
  }
  return merged;
}

async function collectSqliteItemIds(
  options: Readonly<{
    platform?: string;
    feedUrl?: string;
    saved?: boolean;
    archived?: boolean;
  }>,
  include: (item: FeedItem) => boolean,
): Promise<string[]> {
  const filters = options ?? {};
  const ids: string[] = [];
  await scanLibraryCoreNormalizedBackgroundItemsV1(
    NORMALIZED_MUTATION_READER_RUNTIME,
    (items) => {
      for (const item of items) {
        if (
          filters.platform !== undefined &&
          item.platform !== filters.platform
        ) {
          continue;
        }
        if (
          filters.feedUrl !== undefined &&
          item.rssSource?.feedUrl !== filters.feedUrl
        ) {
          continue;
        }
        if (
          filters.saved !== undefined &&
          item.userState.saved !== filters.saved
        ) {
          continue;
        }
        if (
          filters.archived !== undefined &&
          item.userState.archived !== filters.archived
        ) {
          continue;
        }
        if (include(item)) ids.push(item.globalId);
      }
      return "continue";
    },
  );
  return ids;
}

async function mutateItems(
  mutation: string,
  options: {
    ids?: readonly string[];
    platform?: string;
    feedUrl?: string;
    timestampMs?: number;
    maxAgeMs?: number;
  } = {},
): Promise<number> {
  requireBrowserTestProjection("generic item mutation");
  const ids = options.ids ?? [];
  const timestampMs = options.timestampMs ?? Date.now();
  const mutate = (
    window as unknown as {
      __FREED_E2E_NORMALIZED_MUTATE_ITEMS__?: (request: {
        mutation: string;
        ids: readonly string[],
        platform: string | null;
        feedUrl: string | null;
        timestampMs: number;
        maxAgeMs: number | null;
      }) => number;
    }
  ).__FREED_E2E_NORMALIZED_MUTATE_ITEMS__;
  if (!mutate) {
    throw new Error("Browser SQLite test mutation bridge is unavailable");
  }
  const mutateBatch = (batch: readonly string[]) =>
    mutate({
      mutation,
      ids: [...batch],
      platform: options.platform ?? null,
      feedUrl: options.feedUrl ?? null,
      timestampMs,
      maxAgeMs: options.maxAgeMs ?? null,
    });
  if (ids.length === 0) return mutateBatch([]);
  let affected = 0;
  for (let start = 0; start < ids.length; start += 1_000) {
    affected += mutateBatch(ids.slice(start, start + 1_000));
  }
  return affected;
}

function deepMerge<T>(current: T, update: Partial<T>): T {
  if (
    !current ||
    !update ||
    typeof current !== "object" ||
    typeof update !== "object"
  ) {
    return update as T;
  }
  const next = { ...(current as Record<string, unknown>) };
  for (const [key, value] of Object.entries(
    update as Record<string, unknown>,
  )) {
    const previous = next[key];
    next[key] =
      previous &&
      value &&
      typeof previous === "object" &&
      typeof value === "object" &&
      !Array.isArray(previous) &&
      !Array.isArray(value)
        ? deepMerge(previous, value)
        : value;
  }
  return next as T;
}

async function refreshSqliteLibraryCounts(state: DocState): Promise<DocState> {
  const facets = await queryNormalizedLibrary({
    queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
    schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  });
  return {
    ...state,
    searchCorpusVersion: facets.source.transitionSequence,
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: facets.summary.unreadCount,
    unreadCountByPlatform: Object.fromEntries(
      facets.summary.platformCounts.map((count) => [
        count.platform,
        count.unreadCount,
      ]),
    ),
    totalItemCount: facets.summary.totalCount,
    itemCountByPlatform: Object.fromEntries(
      facets.summary.platformCounts.map((count) => [
        count.platform,
        count.totalCount,
      ]),
    ),
    totalArchivableCount: facets.summary.archivableCount,
    archivableCountByPlatform: Object.fromEntries(
      facets.summary.platformCounts.map((count) => [
        count.platform,
        count.archivableCount,
      ]),
    ),
    archivableFeedCounts: {},
    docItemCount: facets.summary.totalCount,
  };
}

const NORMALIZED_MUTATION_READER_RUNTIME = Object.freeze({
  query: queryNormalizedLibrary,
  randomId: () => crypto.randomUUID(),
});

function normalizedSampleFingerprint(
  batchId: string | null,
  generatedAt: number | null,
  generatorVersion: number | null,
): FeedItem["sampleDataFingerprint"] {
  return batchId !== null && generatedAt !== null && generatorVersion !== null
    ? {
        marker: "freed.sample-data.v1",
        batchId,
        generatedAt,
        generatorVersion,
      }
    : undefined;
}

async function readNormalizedPerson(personId: string): Promise<Person | null> {
  const response = await queryNormalizedLibrary({
    personId,
    queryId: LIBRARY_CORE_PERSON_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION,
  });
  const person = response.person;
  if (!person) return null;
  const sampleDataFingerprint = normalizedSampleFingerprint(
    person.sampleBatchId,
    person.sampleGeneratedAt,
    person.sampleGeneratorVersion,
  );
  return {
    id: person.id,
    name: person.name,
    relationshipStatus:
      person.relationshipStatus as Person["relationshipStatus"],
    careLevel: person.careLevel as Person["careLevel"],
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    ...(person.avatarUrl === null ? {} : { avatarUrl: person.avatarUrl }),
    ...(person.bio === null ? {} : { bio: person.bio }),
    ...(person.reachOutIntervalDays === null
      ? {}
      : { reachOutIntervalDays: person.reachOutIntervalDays }),
    ...(person.notes === null ? {} : { notes: person.notes }),
    ...(person.tags.length === 0 ? {} : { tags: [...person.tags] }),
    ...(person.reachOuts.length === 0
      ? {}
      : {
          reachOutLog: person.reachOuts.map((entry) => ({
            loggedAt: entry.loggedAt,
            ...(entry.channel === null
              ? {}
              : { channel: entry.channel as ReachOutLog["channel"] }),
            ...(entry.notes === null ? {} : { notes: entry.notes }),
          })),
        }),
    ...(sampleDataFingerprint === undefined ? {} : { sampleDataFingerprint }),
  };
}

async function readNormalizedAccount(accountId: string): Promise<Account | null> {
  const response = await queryNormalizedLibrary({
    accountId,
    queryId: LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION,
  });
  const account = response.account;
  if (!account) return null;
  const sampleDataFingerprint = normalizedSampleFingerprint(
    account.sampleBatchId,
    account.sampleGeneratedAt,
    account.sampleGeneratorVersion,
  );
  return {
    id: account.id,
    kind: account.kind as Account["kind"],
    provider: account.provider as Account["provider"],
    externalId: account.externalId,
    firstSeenAt: account.firstSeenAt,
    lastSeenAt: account.lastSeenAt,
    discoveredFrom: account.discoveredFrom as Account["discoveredFrom"],
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    ...(account.personId === null ? {} : { personId: account.personId }),
    ...(account.handle === null ? {} : { handle: account.handle }),
    ...(account.displayName === null
      ? {}
      : { displayName: account.displayName }),
    ...(account.avatarUrl === null ? {} : { avatarUrl: account.avatarUrl }),
    ...(account.profileUrl === null
      ? {}
      : { profileUrl: account.profileUrl }),
    ...(account.email === null ? {} : { email: account.email }),
    ...(account.phone === null ? {} : { phone: account.phone }),
    ...(account.address === null ? {} : { address: account.address }),
    ...(account.importedAt === null ? {} : { importedAt: account.importedAt }),
    ...(account.followRosterActive === null
      ? {}
      : { followRosterActive: account.followRosterActive }),
    ...(account.followRosterSyncedAt === null
      ? {}
      : { followRosterSyncedAt: account.followRosterSyncedAt }),
    ...(account.followRosterRoles.length === 0
      ? {}
      : {
          followRosterRoles:
            account.followRosterRoles as Account["followRosterRoles"],
        }),
    ...(sampleDataFingerprint === undefined ? {} : { sampleDataFingerprint }),
  };
}

async function readNormalizedRssFeed(url: string): Promise<RssFeed | null> {
  const response = await queryNormalizedLibrary({
    queryId: LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
    url,
  });
  const feed = response.feed;
  if (!feed) return null;
  const sampleDataFingerprint = normalizedSampleFingerprint(
    feed.sampleBatchId,
    feed.sampleGeneratedAt,
    feed.sampleGeneratorVersion,
  );
  return {
    enabled: feed.enabled,
    title: feed.title,
    trackUnread: feed.trackUnread,
    url: feed.url,
    ...(feed.siteUrl === null ? {} : { siteUrl: feed.siteUrl }),
    ...(feed.lastFetched === null ? {} : { lastFetched: feed.lastFetched }),
    ...(feed.imageUrl === null ? {} : { imageUrl: feed.imageUrl }),
    ...(feed.pollInterval === null ? {} : { pollInterval: feed.pollInterval }),
    ...(feed.folder === null ? {} : { folder: feed.folder }),
    ...(sampleDataFingerprint === undefined ? {} : { sampleDataFingerprint }),
  };
}

async function refreshNormalizedMutationProjection(
  state: DocState,
  changedIds: readonly string[],
): Promise<{ state: DocState; changedItems: FeedItem[] }> {
  const facets = await queryNormalizedLibrary({
    queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
    schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  });
  const changedItems: FeedItem[] = [];
  for (const globalId of changedIds) {
    const item = await readLibraryCoreNormalizedItemDetailV1(
      NORMALIZED_MUTATION_READER_RUNTIME,
      globalId,
    );
    if (item) changedItems.push(item);
  }
  return {
    state: {
      ...state,
      searchCorpusVersion: facets.source.transitionSequence,
      totalItemCount: facets.summary.totalCount,
      docItemCount: facets.summary.totalCount,
    },
    changedItems,
  };
}

async function saveMetadataMutation(
  current: DocState,
  update: (next: DocState) => void,
): Promise<DocState> {
  const next: DocState = {
    ...current,
    feeds: { ...current.feeds },
    persons: { ...current.persons },
    accounts: { ...current.accounts },
    friends: { ...current.friends },
    preferences: { ...current.preferences },
  };
  update(next);
  if (import.meta.env.VITE_TEST_TAURI !== "1") {
    throw new Error(
      "Normalized SQLite mutation context is required for durable Library metadata",
    );
  }
  return next;
}

export async function dispatchSqliteMutation(
  message: WorkerRequest,
  current: DocState,
): Promise<{ state: DocState; event: DocChangeEvent; result?: unknown }> {
  const timestamp = Date.now();
  let changedIds: string[] = [];
  let source: DocChangeEvent["source"] = "state_update";
  let result: unknown;
  let nextState = current;
  const projectMetadata = (update: (next: DocState) => void) => {
    nextState = {
      ...nextState,
      feeds: { ...nextState.feeds },
      persons: { ...nextState.persons },
      accounts: { ...nextState.accounts },
      friends: { ...nextState.friends },
      preferences: { ...nextState.preferences },
    };
    update(nextState);
  };
  const saveMetadata = async (
    update: (next: DocState) => void,
    normalizedHandled = false,
  ) => {
    if (normalizedHandled) {
      projectMetadata(update);
    } else {
      nextState = await saveMetadataMutation(nextState, update);
    }
  };
  const saveDiscoveredAccounts = async (items: readonly FeedItem[]) => {
    const missing = buildDiscoveredAccountsFromItems(
      [...items],
      current.accounts,
    );
    if (missing.length === 0) return;
    const normalizedHandled = await maybeSubmitAccountUpserts(
      missing,
      timestamp,
    );
    await saveMetadata((next) => {
      for (const account of missing) next.accounts[account.id] = account;
    }, normalizedHandled);
  };

  switch (message.type) {
    case "ADD_FEED_ITEM": {
      const inserted = await insertMissingSqliteItems([message.item]);
      await saveDiscoveredAccounts([message.item]);
      changedIds = inserted.map((item) => item.globalId);
      source = "item_patch";
      break;
    }
    case "ADD_FEED_ITEMS":
    case "BATCH_IMPORT_ITEMS": {
      const inserted = await insertMissingSqliteItems(message.items);
      await saveDiscoveredAccounts(message.items);
      changedIds = inserted.map((item) => item.globalId);
      source = "item_patch";
      break;
    }
    case "RECONCILE_YOUTUBE_CAPTURE":
    case "RECONCILE_FOLLOW_ROSTER_CAPTURE": {
      const merged = await mergeIncomingSqliteItems(message.items);
      const reconciled = new Map<string, Account>();
      const incomingIds = new Set(
        message.accounts.map((account) => account.id),
      );
      for (const account of message.accounts) {
        const existing =
          nextState.accounts[account.id] ??
          (await readNormalizedAccount(account.id));
        reconciled.set(
          account.id,
          existing ? { ...existing, ...account } : account,
        );
      }
      if (
        message.type === "RECONCILE_YOUTUBE_CAPTURE" &&
        message.options.rosterComplete
      ) {
        for (const [id, account] of Object.entries(nextState.accounts)) {
          if (
            account.provider === "youtube" &&
            account.discoveredFrom === "follow_roster" &&
            !incomingIds.has(id)
          ) {
            reconciled.set(id, {
              ...account,
              followRosterActive: false,
              followRosterSyncedAt: message.options.capturedAt,
              updatedAt: message.options.capturedAt,
            });
          }
        }
      }
      const normalizedHandled = await maybeSubmitAccountUpserts(
        [...reconciled.values()],
        timestamp,
      );
      await saveMetadata((next) => {
        for (const [id, account] of reconciled) next.accounts[id] = account;
      }, normalizedHandled);
      changedIds = merged.map((item) => item.globalId);
      break;
    }
    case "ADD_SAMPLE_LIBRARY_DATA": {
      await insertMissingSqliteItems(message.items);
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        for (const feed of message.feeds) {
          await maybeSubmitRssFeedUpsert(feed, timestamp);
        }
        await maybeSubmitPersonUpserts(message.persons, timestamp);
        await maybeSubmitAccountUpserts(message.accounts, timestamp);
      }
      await saveMetadata((next) => {
        for (const feed of message.feeds) next.feeds[feed.url] = feed;
        for (const person of message.persons) next.persons[person.id] = person;
        for (const account of message.accounts)
          next.accounts[account.id] = account;
      }, normalizedHandled);
      changedIds = message.items.map((item) => item.globalId);
      break;
    }
    case "CLEAR_SAMPLE_DATA": {
      const samplePersonIds = new Set(
        Object.values(current.persons)
          .filter(hasSampleDataFingerprint)
          .map((person) => person.id),
      );
      const sampleFeeds = Object.values(current.feeds).filter(
        hasSampleDataFingerprint,
      );
      const sampleAccounts = Object.values(current.accounts).filter(
        hasSampleDataFingerprint,
      );
      const normalizedHandled = (await mutationContext()) !== null;
      const sampleItemIds = normalizedHandled
        ? await collectSqliteItemIds({}, hasSampleDataFingerprint)
        : [];
      if (normalizedHandled) {
        await maybeSubmitFeedItemRemoves(sampleItemIds, timestamp);
        for (const feed of sampleFeeds) {
          await maybeSubmitRssFeedRemove({
            includeItems: false,
            removedAtMs: timestamp,
            url: feed.url,
          });
        }
        for (const personId of samplePersonIds) {
          await maybeSubmitPersonRemove(personId, timestamp);
        }
        for (const account of sampleAccounts) {
          await maybeSubmitAccountRemove(account.id, timestamp);
        }
      }
      const summary = {
        feeds: sampleFeeds.length,
        items: normalizedHandled
          ? sampleItemIds.length
          : await mutateItems("clear_sample", { timestampMs: timestamp }),
        persons: samplePersonIds.size,
        accounts: sampleAccounts.length,
        total: 0,
      };
      summary.total =
        summary.feeds + summary.items + summary.persons + summary.accounts;
      await saveMetadata((next) => {
        for (const [url, feed] of Object.entries(next.feeds)) {
          if (hasSampleDataFingerprint(feed)) delete next.feeds[url];
        }
        for (const [id, account] of Object.entries(next.accounts)) {
          if (hasSampleDataFingerprint(account)) {
            delete next.accounts[id];
          } else if (
            account.personId &&
            samplePersonIds.has(account.personId)
          ) {
            if (normalizedHandled) {
              delete next.accounts[id];
            } else {
              next.accounts[id] = {
                ...account,
                personId: undefined,
                updatedAt: timestamp,
              };
            }
          }
        }
        for (const personId of samplePersonIds) delete next.persons[personId];
      }, normalizedHandled);
      result = summary;
      break;
    }
    case "UPDATE_FEED_ITEM": {
      const [item] = await readSqliteItems([message.globalId]);
      if (item) {
        const updated = deepMerge(item, message.updates);
        if (!(await maybeSubmitFeedItemCaptures([updated], timestamp))) {
          await upsertSqliteItems([updated]);
        }
      }
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    }
    case "MARK_AS_READ":
      if (!(await maybeSubmitReadAssignments([message.globalId], timestamp))) {
        await mutateItems("mark_read", {
          ids: [message.globalId],
          timestampMs: timestamp,
        });
      }
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "MARK_ITEMS_AS_READ":
      if (!(await maybeSubmitReadAssignments(message.globalIds, timestamp))) {
        await mutateItems("mark_read", {
          ids: message.globalIds,
          timestampMs: timestamp,
        });
      }
      changedIds = [...message.globalIds];
      source = "item_patch";
      break;
    case "MARK_ALL_AS_READ": {
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        const ids = await collectSqliteItemIds(
          { platform: message.platform },
          (item) => item.userState.readAt === undefined,
        );
        await maybeSubmitReadAssignments(ids, timestamp);
      } else {
        await mutateItems("mark_all_read", {
          platform: message.platform,
          timestampMs: timestamp,
        });
      }
      break;
    }
    case "TOGGLE_SAVED": {
      const [item] = await readSqliteItems([message.globalId]);
      const assigned = item?.userState?.saved !== true;
      if (
        !(await maybeSubmitUserStateAssignments([
          {
            entityId: message.globalId,
            field: "saved",
            assigned,
            assignedAtMs: timestamp,
          },
        ]))
      ) {
        await mutateItems("toggle_saved", {
          ids: [message.globalId],
          timestampMs: timestamp,
        });
      }
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    }
    case "TOGGLE_ARCHIVED": {
      const [item] = await readSqliteItems([message.globalId]);
      const assigned = item?.userState?.archived !== true;
      if (
        !(await maybeSubmitUserStateAssignments([
          {
            entityId: message.globalId,
            field: "archived",
            assigned,
            assignedAtMs: timestamp,
          },
        ]))
      ) {
        await mutateItems("toggle_archived", {
          ids: [message.globalId],
          timestampMs: timestamp,
        });
      }
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    }
    case "ARCHIVE_ITEMS":
      if (
        !(await maybeSubmitUserStateAssignments(
          message.globalIds.map((entityId) => ({
            entityId,
            field: "archived" as const,
            assigned: true,
            assignedAtMs: timestamp,
          })),
        ))
      ) {
        await mutateItems("archive", {
          ids: message.globalIds,
          timestampMs: timestamp,
        });
      }
      changedIds = [...message.globalIds];
      source = "item_patch";
      break;
    case "TOGGLE_LIKED": {
      const [item] = await readSqliteItems([message.globalId]);
      const assigned = item?.userState?.liked !== true;
      if (
        !(await maybeSubmitUserStateAssignments([
          {
            entityId: message.globalId,
            field: "liked",
            assigned,
            assignedAtMs: timestamp,
          },
        ]))
      ) {
        await mutateItems("toggle_liked", {
          ids: [message.globalId],
          timestampMs: timestamp,
        });
      }
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    }
    case "CONFIRM_LIKED_SYNCED":
      await submitProviderSyncReceipt(
        "feed_item_like_sync_receipt",
        message.globalId,
        message.syncedAt ?? timestamp,
      );
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "CONFIRM_SEEN_SYNCED":
      await submitProviderSyncReceipt(
        "feed_item_seen_sync_receipt",
        message.globalId,
        message.syncedAt ?? timestamp,
      );
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "REMOVE_FEED_ITEM":
      if (!(await maybeSubmitFeedItemRemoves([message.globalId], timestamp))) {
        await mutateItems("delete", {
          ids: [message.globalId],
          timestampMs: timestamp,
        });
      }
      changedIds = [message.globalId];
      break;
    case "ARCHIVE_ALL_READ_UNSAVED": {
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        const ids = await collectSqliteItemIds(
          { platform: message.platform, feedUrl: message.feedUrl },
          (item) =>
            item.userState.readAt !== undefined &&
            !item.userState.saved &&
            !item.userState.archived &&
            !item.userState.hidden,
        );
        await maybeSubmitUserStateAssignments(
          ids.map((entityId) => ({
            entityId,
            field: "archived" as const,
            assigned: true,
            assignedAtMs: timestamp,
          })),
        );
      } else {
        await mutateItems("archive_all_read_unsaved", {
          platform: message.platform,
          feedUrl: message.feedUrl,
          timestampMs: timestamp,
        });
      }
      break;
    }
    case "UNARCHIVE_SAVED_ITEMS": {
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        const ids = await collectSqliteItemIds(
          { saved: true, archived: true },
          () => true,
        );
        await maybeSubmitUserStateAssignments(
          ids.map((entityId) => ({
            entityId,
            field: "archived" as const,
            assigned: false,
            assignedAtMs: timestamp,
          })),
        );
      } else {
        await mutateItems("unarchive_saved", { timestampMs: timestamp });
      }
      break;
    }
    case "DELETE_ALL_ARCHIVED": {
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        const ids = await collectSqliteItemIds(
          { archived: true },
          (item) => !item.userState.saved,
        );
        await maybeSubmitFeedItemRemoves(ids, timestamp);
      } else {
        await mutateItems("delete_all_archived", { timestampMs: timestamp });
      }
      break;
    }
    case "PRUNE_ARCHIVED_ITEMS": {
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        const cutoff = timestamp - Math.max(0, message.maxAgeMs ?? 0);
        const ids = await collectSqliteItemIds(
          { archived: true },
          (item) =>
            !item.userState.saved &&
            item.userState.archivedAt !== undefined &&
            item.userState.archivedAt <= cutoff,
        );
        await maybeSubmitFeedItemRemoves(ids, timestamp);
      } else {
        await mutateItems("prune_archived", {
          maxAgeMs: message.maxAgeMs,
          timestampMs: timestamp,
        });
      }
      break;
    }
    case "ADD_RSS_FEED": {
      const normalizedHandled = await maybeSubmitRssFeedUpsert(
        message.feed,
        timestamp,
      );
      await saveMetadata((next) => {
        next.feeds[message.feed.url] = message.feed;
      }, normalizedHandled);
      break;
    }
    case "UPDATE_RSS_FEED": {
      const feed =
        nextState.feeds[message.url] ??
        (await readNormalizedRssFeed(message.url));
      const updated = feed ? { ...feed, ...message.updates } : null;
      const normalizedHandled = updated
        ? await maybeSubmitRssFeedUpsert(updated, timestamp)
        : false;
      await saveMetadata((next) => {
        if (updated) next.feeds[message.url] = updated;
      }, normalizedHandled);
      break;
    }
    case "REMOVE_RSS_FEED": {
      const normalizedHandled = await maybeSubmitRssFeedRemove({
        includeItems: message.includeItems === true,
        removedAtMs: timestamp,
        url: message.url,
      });
      if (message.includeItems && !normalizedHandled) {
        await mutateItems("delete_rss", {
          feedUrl: message.url,
          timestampMs: timestamp,
        });
      }
      await saveMetadata((next) => {
        delete next.feeds[message.url];
      }, normalizedHandled);
      break;
    }
    case "REMOVE_ALL_FEEDS": {
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        await executeFrozenRssFeedScope(
          message.includeItems === true
            ? "rss_feeds_remove_with_items"
            : "rss_feeds_remove_keep_items",
          timestamp,
          async (urls) => {
            if (
              !(await maybeSubmitRssFeedRemoves(
                urls,
                message.includeItems === true,
                timestamp,
              ))
            ) {
              throw new Error(
                "Library mutation context changed during frozen RSS Feed removal",
              );
            }
          },
        );
      } else if (message.includeItems) {
        await mutateItems("delete_rss", { timestampMs: timestamp });
      }
      await saveMetadata((next) => {
        next.feeds = {};
      }, normalizedHandled);
      break;
    }
    case "UPDATE_PREFERENCES": {
      const normalizedHandled = await maybeSubmitPreferences(
        message.updates,
        timestamp,
      );
      await saveMetadata((next) => {
        next.preferences = deepMerge<UserPreferences>(
          next.preferences,
          message.updates,
        );
      }, normalizedHandled);
      source = "preferences_patch";
      break;
    }
    case "ADD_PERSON": {
      const normalizedHandled = await maybeSubmitPersonUpserts(
        [message.person],
        timestamp,
      );
      await saveMetadata((next) => {
        next.persons[message.person.id] = message.person;
      }, normalizedHandled);
      break;
    }
    case "ADD_PERSONS": {
      const normalizedHandled = await maybeSubmitPersonUpserts(
        message.persons,
        timestamp,
      );
      await saveMetadata((next) => {
        for (const person of message.persons) next.persons[person.id] = person;
      }, normalizedHandled);
      break;
    }
    case "UPDATE_PERSON": {
      const person =
        nextState.persons[message.personId] ??
        (await readNormalizedPerson(message.personId));
      const updated = person ? { ...person, ...message.updates } : null;
      const normalizedHandled = updated
        ? await maybeSubmitPersonUpserts([updated], timestamp)
        : false;
      await saveMetadata((next) => {
        if (updated) next.persons[message.personId] = updated;
      }, normalizedHandled);
      break;
    }
    case "UPSERT_CONNECTION_PERSONS": {
      const persons = message.candidates.map((candidate) => candidate.person);
      const accounts: Account[] = [];
      for (const candidate of message.candidates) {
        for (const accountId of candidate.accountIds) {
          const account =
            nextState.accounts[accountId] ??
            (await readNormalizedAccount(accountId));
          if (account)
            accounts.push({ ...account, personId: candidate.person.id });
        }
      }
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        await maybeSubmitPersonUpserts(persons, timestamp);
        await maybeSubmitAccountUpserts(accounts, timestamp);
      }
      await saveMetadata((next) => {
        for (const person of persons) next.persons[person.id] = person;
        for (const account of accounts) next.accounts[account.id] = account;
      }, normalizedHandled);
      break;
    }
    case "REMOVE_PERSON": {
      const normalizedHandled = await maybeSubmitPersonRemove(
        message.personId,
        timestamp,
      );
      await saveMetadata((next) => {
        delete next.persons[message.personId];
        for (const [id, account] of Object.entries(next.accounts)) {
          if (account.personId !== message.personId) continue;
          if (normalizedHandled) {
            delete next.accounts[id];
          } else {
            next.accounts[id] = { ...account, personId: undefined };
          }
        }
      }, normalizedHandled);
      break;
    }
    case "LOG_REACH_OUT": {
      const person =
        nextState.persons[message.personId] ??
        (await readNormalizedPerson(message.personId));
      const updated = person
        ? {
            ...person,
            reachOutLog: [message.entry, ...(person.reachOutLog ?? [])].slice(
              0,
              20,
            ) as ReachOutLog[],
            updatedAt: timestamp,
          }
        : null;
      const normalizedHandled = updated
        ? await maybeSubmitPersonUpserts([updated], timestamp)
        : false;
      await saveMetadata((next) => {
        if (updated) next.persons[message.personId] = updated;
      }, normalizedHandled);
      break;
    }
    case "ADD_ACCOUNT": {
      const normalizedHandled = await maybeSubmitAccountUpserts(
        [message.account],
        timestamp,
      );
      await saveMetadata((next) => {
        next.accounts[message.account.id] = message.account;
      }, normalizedHandled);
      break;
    }
    case "ADD_ACCOUNTS": {
      const normalizedHandled = await maybeSubmitAccountUpserts(
        message.accounts,
        timestamp,
      );
      await saveMetadata((next) => {
        for (const account of message.accounts)
          next.accounts[account.id] = account;
      }, normalizedHandled);
      break;
    }
    case "UPDATE_ACCOUNT": {
      const account =
        nextState.accounts[message.accountId] ??
        (await readNormalizedAccount(message.accountId));
      const updated = account ? { ...account, ...message.updates } : null;
      const normalizedHandled = updated
        ? await maybeSubmitAccountUpserts([updated], timestamp)
        : false;
      await saveMetadata((next) => {
        if (updated) next.accounts[message.accountId] = updated;
      }, normalizedHandled);
      break;
    }
    case "REMOVE_ACCOUNT": {
      const normalizedHandled = await maybeSubmitAccountRemove(
        message.accountId,
        timestamp,
      );
      await saveMetadata((next) => {
        delete next.accounts[message.accountId];
      }, normalizedHandled);
      break;
    }
    case "BATCH_REFRESH_FEEDS": {
      await mergeIncomingSqliteItems(message.items);
      const feeds: RssFeed[] = [];
      for (const update of message.feeds) {
        const feed =
          nextState.feeds[update.url] ??
          (await readNormalizedRssFeed(update.url));
        if (feed) feeds.push({ ...feed, ...update });
      }
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        for (const feed of feeds) {
          await maybeSubmitRssFeedUpsert(feed, timestamp);
        }
      }
      await saveMetadata((next) => {
        for (const feed of feeds) next.feeds[feed.url] = feed;
      }, normalizedHandled);
      changedIds = message.items.map((item) => item.globalId);
      break;
    }
    case "HEAL_UNTITLED_FEEDS": {
      const visibleAssignments: Array<{ title: string; url: string }> = [];
      for (const feed of Object.values(nextState.feeds)) {
        if (feed.title !== "Untitled Feed" && feed.title !== feed.url) continue;
        const title = repairedRssFeedTitle(feed.url);
        if (title && title !== feed.title) {
          visibleAssignments.push({ title, url: feed.url });
        }
      }
      const normalizedHandled = (await mutationContext()) !== null;
      if (normalizedHandled) {
        await executeFrozenRssFeedScope(
          "rss_feeds_heal_untitled_frozen",
          timestamp,
          async (urls) => {
            const assignments = urls.flatMap((url) => {
              const title = repairedRssFeedTitle(url);
              return title ? [{ title, url }] : [];
            });
            if (
              !(await maybeSubmitRssFeedTitleAssignments(
                assignments,
                timestamp,
              ))
            ) {
              throw new Error(
                "Library mutation context changed during frozen RSS Feed repair",
              );
            }
          },
        );
      }
      await saveMetadata((next) => {
        for (const assignment of visibleAssignments) {
          const feed = next.feeds[assignment.url];
          if (feed) next.feeds[assignment.url] = { ...feed, ...assignment };
        }
      }, normalizedHandled);
      break;
    }
    case "DEDUPLICATE_ITEMS":
    case "BACKFILL_CONTENT_SIGNALS":
      break;
    default:
      throw new Error(`SQLite Library does not implement ${message.type}`);
  }

  const selectedPrimary = await primaryMutationContext();
  let state: DocState;
  let changedItems: FeedItem[];
  if (selectedPrimary) {
    const normalized = await refreshNormalizedMutationProjection(
      nextState,
      changedIds,
    );
    state = normalized.state;
    changedItems = normalized.changedItems;
  } else {
    // The browser harness keeps only the current visible test projection.
    // Durable test rows remain behind its bounded query command, just as
    // production rows remain behind native SQLite.
    state = await refreshSqliteLibraryCounts(nextState);
    changedItems =
      changedIds.length > 0 ? await readSqliteItems(changedIds) : [];
  }
  const event: DocChangeEvent =
    source === "item_patch"
      ? {
          source,
          mutation: message.type,
          changedItemIds: changedIds,
          changedItems,
          requiresFullScan: false,
        }
      : source === "preferences_patch"
        ? {
            source,
            mutation: message.type,
            changedItemIds: null,
            changedItems: [],
            requiresFullScan: false,
          }
        : {
            source: "state_update",
            mutation: message.type,
            changedItemIds: null,
            requiresFullScan: true,
          };
  return { state, event, result };
}

export async function createSqliteLibraryBackup(
  reason: "auto" | "manual",
): Promise<SqliteLibraryBackupSummary> {
  return invoke<SqliteLibraryBackupSummary>("create_sqlite_library_backup", {
    createdAtMs: Date.now(),
    reason,
  });
}

export async function listSqliteLibraryBackups(): Promise<
  SqliteLibraryBackupSummary[]
> {
  return invoke<SqliteLibraryBackupSummary[]>("list_sqlite_library_backups");
}

export async function readSqliteLibraryBackupChunk(input: {
  readonly backupId: string;
  readonly offset: number;
  readonly limit?: number;
}): Promise<SqliteLibraryBackupChunk> {
  return invoke<SqliteLibraryBackupChunk>("read_sqlite_library_backup_chunk", {
    request: {
      backupId: input.backupId,
      offset: input.offset,
      limit: input.limit ?? 1_048_576,
    },
  });
}

export async function restoreSqliteLibraryBackup(
  backupId: string,
): Promise<SqliteLibraryBackupSummary> {
  const restored = await invoke<SqliteLibraryBackupSummary>(
    "restore_sqlite_library_backup",
    { backupId },
  );
  sqliteActive = true;
  return restored;
}

export async function clearSqliteLibraryBackups(): Promise<void> {
  await invoke("clear_sqlite_library_backups");
}

export async function clearSqliteLibrary(): Promise<void> {
  await invoke("clear_sqlite_library");
  sqliteActive = false;
}
