import { createLibraryCoreSqliteActivatePredecessorWorkerRequest, createLibraryCoreSqlitePredecessorReadWorkerRequest,
  parseLibraryCorePredecessorCheckpointReadV1, type LibraryCoreActivateNormalizedCheckpointStageV2 } from "@freed/shared/library-core";
import { snapshotLibraryCoreRecoveryPreferencePatchesV1 } from "@freed/shared/library-core";
import { PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA } from "@freed/shared/library-core";
import type { RecoveryReachOutDraft } from "@freed/ui/components/RecoveryReachOutFields";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
/**
 * SQLite-only Freed Desktop Library runtime.
 */

import {
  parseLibraryCoreNormalizedOperationExportDescriptorV2,
  parseLibraryCoreNormalizedOperationExportRequestV2,
  parseLibraryCoreNormalizedOperationExportPageV2,
  parseLibraryCoreNormalizedOperationImportPageV2,
  parseLibraryCoreNormalizedOperationImportReceiptV2,
  type LibraryCoreNormalizedOperationExportRequestV2,
  type LibraryCoreNormalizedOperationImportPageV2,
} from "@freed/shared/library-core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  buildDiscoveredAccountsFromItems,
  buildConnectionPersonDraftFromAccounts,
  sanitizeAccountWrite,
  sanitizeFeedItemCaptureWrite,
  sanitizePersonRootWrite,
  sanitizeReachOutLogWrite,
  sanitizeRssFeedWrite,
  assertSupportedUserPreferenceWrite,
  type Account,
  type FeedItem,
  type Highlight,
  type Person,
  type ReachOutLog,
  type RssFeed,
  type UserPreferences,
} from "@freed/shared";
import {
  ACCOUNT_PERSON_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  assembleLibraryCoreTransactionV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreFractionalNumbersV1,
  encodeLibraryCoreOperationSignatureInput,
  digestLibraryCoreRssFeedScopeActionRequestV1,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ANALYSIS_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_SYNC_RECEIPT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_PRIORITY_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SEEN_SYNC_RECEIPT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  FRIEND_REPLACE_MAXIMUM_ACCOUNTS,
  FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  compareLibraryCoreUtf8V1,
  FRIEND_REPLACE_PAYLOAD_SCHEMA,
  finalizeLibraryCoreTransactionV1,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
  LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID,
  LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION,
  LIBRARY_CORE_RSS_FEED_DETAIL_QUERY_ID,
  LIBRARY_CORE_RSS_FEED_DETAIL_SCHEMA_VERSION,
  libraryCoreRuntimeStateFromFacetSummaryV1,
  PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA,
  PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  parseLibraryCoreNormalizedCheckpointExportPageV2,
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointActivationReceiptV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  parseLibraryCoreNormalizedCheckpointStageStatusV2,
  parseLibraryCoreFollowerTransportContextV2,
  parseLibraryCoreFollowerTransportPageRequestV2,
  parseLibraryCoreFollowerTransportPageResponseV2,
  parseLibraryCoreNormalizedIntentTransportPublicationV2,
  parseLibraryCoreNormalizedResultTransportImportV2,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  readLibraryCoreNormalizedPreferencesV1,
  collectLibraryCoreSampleRemovalPlanV1,
  scanLibraryCoreAccountRowsV1,
  scanLibraryCoreNormalizedBackgroundItemsV1,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  readLibraryCoreNormalizedItemDetailV1,
  canonicalizeFeedItemTagsV1,
  canonicalizeFeedItemHighlightsV1,
  canonicalizeFeedItemAnalysisV1,
  sha256LowerHex,
  type AccountRemoveTransactionMemberInputV1,
  type AccountPersonAssignmentTransactionMemberInputV1,
  type AccountUpsertTransactionMemberInputV1,
  type FeedItemCaptureUpsertTransactionMemberInputV1,
  type FeedItemAnalysisReplaceTransactionMemberInputV1,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type FeedItemPriorityAssignmentTransactionMemberInputV1,
  type FeedItemRemoveTransactionMemberInputV1,
  type FeedItemSyncReceiptTransactionMemberInputV1,
  type FeedItemAnnotationsReplaceTransactionMemberInputV1,
  type FeedItemUserStateAssignmentFieldV1,
  type FeedItemUserStateAssignmentTransactionMemberInputV1,
  type FriendReplaceTransactionMemberInputV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreFollowerTransportContextV2,
  type LibraryCoreFollowerTransportPageRequestV2,
  type LibraryCoreFollowerTransportPageResponseV2,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedCheckpointCursorV2,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointExportPageV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreNormalizedIntentTransportPublicationReceiptV2,
  type LibraryCoreNormalizedIntentTransportPublicationV2,
  type LibraryCoreNormalizedIntentEnvelopeRecordV2,
  type LibraryCoreNormalizedResultTransportImportReceiptV2,
  type LibraryCoreNormalizedResultTransportImportV2,
  type LibraryCoreOperationInstanceId,
  type LibraryCoreRssFeedScopeActionKindV1,
  type LibraryCoreRuntimeStateV1,
  type LibraryCoreScopeActionStagePageV1,
  type PersonRemoveTransactionMemberInputV1,
  type PersonReachOutAppendTransactionMemberInputV1,
  type PersonUpsertTransactionMemberInputV1,
  type PreferencesLeafAssignmentTransactionMemberInputV1,
  type RssFeedRemoveTransactionMemberInputV1,
  type RssFeedTitleAssignmentTransactionMemberInputV1,
  type RssFeedUpsertTransactionMemberInputV1,
} from "@freed/shared/library-core";
import type { LibraryCoreAcceptedAuthorityStateV1 } from "@freed/shared/library-core";
import type {
  LibraryMutationEvent,
  LibraryMutationRequest,
} from "./library-types";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { mergeSqliteFeedItem } from "./sqlite-feed-item-merge";

export type SqliteLibraryAcceptedAuthority =
  LibraryCoreAcceptedAuthorityStateV1;

export interface SqliteLibraryPersistedCloudIdentity {
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly writerId: string;
}

export interface NormalizedLibraryCloudIdentity extends LibraryCoreNormalizedCheckpointExportDescriptorV2 {
  readonly localActorId: string;
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
    | "authority_recovery_required"
    | "active";
  readonly libraryId: string | null;
  readonly authorityEpochId: string | null;
  readonly actorId: string | null;
  readonly checkpointGeneration: number | null;
  readonly sourceRevision: number | null;
  readonly pendingIntentCount: number;
  readonly publishedIntentCount: number;
  readonly importedResultCount: number;
  readonly awaitingCanonicalChanges: boolean;
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

export async function readNormalizedLibraryFollowerRuntimeStatus(): Promise<NormalizedLibraryFollowerRuntimeStatus> {
  return invoke<NormalizedLibraryFollowerRuntimeStatus>(
    "normalized_library_follower_runtime_status",
  );
}

export async function readNormalizedLibraryFollowerTransportContext(): Promise<LibraryCoreFollowerTransportContextV2> {
  return parseLibraryCoreFollowerTransportContextV2(
    await invoke<LibraryCoreFollowerTransportContextV2>(
      "normalized_library_follower_transport_context",
    ),
  );
}

export async function pageNormalizedLibraryFollowerTransport(
  input: LibraryCoreFollowerTransportPageRequestV2,
): Promise<LibraryCoreFollowerTransportPageResponseV2> {
  const page = parseLibraryCoreFollowerTransportPageRequestV2(input);
  const response = await invoke<
    Omit<LibraryCoreFollowerTransportPageResponseV2, "canonicalEnvelopes"> &
      Readonly<{ canonicalEnvelopes: readonly (readonly number[])[] }>
  >("page_normalized_library_follower_transport", { page });
  return parseLibraryCoreFollowerTransportPageResponseV2({
    ...response,
    canonicalEnvelopes: response.canonicalEnvelopes.map((bytes) =>
      Uint8Array.from(bytes),
    ),
  });
}

export async function recordNormalizedLibraryFollowerIntentTransportPublication(
  input: LibraryCoreNormalizedIntentTransportPublicationV2,
): Promise<LibraryCoreNormalizedIntentTransportPublicationReceiptV2> {
  const publication =
    parseLibraryCoreNormalizedIntentTransportPublicationV2(input);
  return invoke<LibraryCoreNormalizedIntentTransportPublicationReceiptV2>(
    "record_normalized_library_follower_intent_transport_publication",
    {
      publication: {
        actorId: publication.header.actor_id,
        firstActorCounter: publication.header.first_actor_counter,
        lastActorCounter: publication.header.last_actor_counter,
        libraryId: publication.header.library_id,
        objectKey: publication.reference.descriptor.objectKey,
        previousSegmentDigest: publication.header.previous_segment_digest,
        publishedAt: publication.publishedAt,
        semanticSegmentDigest: publication.header.segment_digest,
        storageEpochId: publication.header.storage_epoch_id,
        storedSegmentDigest: publication.reference.descriptor.contentDigest,
        transportObjectId: publication.reference.transportObjectId,
      },
    },
  );
}

export async function importNormalizedLibraryFollowerResultTransport(
  input: LibraryCoreNormalizedResultTransportImportV2,
): Promise<LibraryCoreNormalizedResultTransportImportReceiptV2> {
  const publication = parseLibraryCoreNormalizedResultTransportImportV2(input);
  return invoke<LibraryCoreNormalizedResultTransportImportReceiptV2>(
    "import_normalized_library_follower_result_transport_segment",
    {
      publication: {
        actorId: publication.header.actor_id,
        libraryId: publication.header.library_id,
        objectKey: publication.reference.descriptor.objectKey,
        previousSegmentDigest: publication.header.previous_segment_digest,
        receivedAt: publication.receivedAt,
        records: publication.results.map((result) => ({
          actorId: result.actor_id,
          authoritativeSourceRevision: result.authoritative_source_revision,
          authorityEpochId: result.epoch_id,
          canonicalResultJson: new TextDecoder("utf-8", { fatal: true }).decode(
            encodeLibraryCoreCanonicalValue(
              result as unknown as LibraryCoreCanonicalValue,
            ),
          ),
          enqueuedAt: result.resolved_at_ms,
          intentEpochId: result.intent_epoch_id,
          originalResultDigest: result.original_result_digest,
          previousResultDigest: result.previous_result_digest,
          rejectionReason: result.rejection_reason,
          resultDigest: result.result_body_digest,
          resultSequence: result.result_sequence,
          status: result.status,
          transactionDigest: result.transaction_digest,
          transactionId: result.transaction_id,
        })),
        semanticSegmentDigest: publication.header.segment_digest,
        storageEpochId: publication.header.storage_epoch_id,
        storedSegmentDigest: publication.reference.descriptor.contentDigest,
        transportObjectId: publication.reference.transportObjectId,
      },
    },
  );
}

export async function countersignNormalizedLibraryFollowerActorRequest(
  canonicalEnrollmentRequestJson: string,
): Promise<NormalizedLibraryFollowerActorEnrollment> {
  return invoke<NormalizedLibraryFollowerActorEnrollment>(
    "countersign_normalized_library_follower_actor_request",
    { canonicalEnrollmentRequestJson, acceptedAt: Date.now() },
  );
}

export interface NormalizedPrimaryFollowerActorTransportState {
  readonly actorId: string;
  readonly libraryId: string;
  readonly storageEpochId: string;
  readonly nextActorCounter: number;
}

export async function readNormalizedPrimaryFollowerActorTransportState(
  actorId: string,
): Promise<NormalizedPrimaryFollowerActorTransportState> {
  return invoke<NormalizedPrimaryFollowerActorTransportState>(
    "normalized_library_primary_follower_actor_transport_state",
    { actorId },
  );
}

export interface NormalizedPrimaryFollowerIntentStageReceipt {
  readonly exactRetries: number;
  readonly pendingTransactions: number;
  readonly resolvedRecords: number;
  readonly resolvedTransactions: number;
  readonly stagedRecords: number;
}

export async function ingestNormalizedLibraryFollowerIntentPage(
  envelopes: readonly LibraryCoreNormalizedIntentEnvelopeRecordV2[],
  canonicalEnvelopes: readonly Uint8Array[],
): Promise<NormalizedPrimaryFollowerIntentStageReceipt> {
  if (
    envelopes.length < 1 ||
    envelopes.length > 128 ||
    canonicalEnvelopes.length !== envelopes.length
  ) {
    throw new RangeError(
      "normalized follower intent page is outside its bound",
    );
  }
  const records = envelopes.map((envelope, index) => ({
    actorCounter: envelope.actor_sequence,
    actorId: envelope.actor_id,
    canonicalEnvelopeJson: new TextDecoder("utf-8", { fatal: true }).decode(
      canonicalEnvelopes[index]!,
    ),
    intentEpoch: envelope.epoch,
    intentEpochId: envelope.epoch_id,
    memberCount: envelope.transaction_member_count,
    memberIndex: envelope.transaction_member_index,
    operationId: envelope.operation_id,
    state: "published",
    transactionDigest: envelope.transaction_digest,
    transactionId: envelope.transaction_id,
  }));
  return invoke<NormalizedPrimaryFollowerIntentStageReceipt>(
    "ingest_normalized_library_follower_intent_page",
    { page: { records }, receivedAt: Date.now() },
  );
}

export interface NormalizedPrimaryFollowerResultRecord {
  readonly transactionId: string;
  readonly transactionDigest: string;
  readonly actorId: string;
  readonly authorityEpochId: string;
  readonly intentEpochId: string;
  readonly resultSequence: number;
  readonly previousResultDigest: string | null;
  readonly resultDigest: string;
  readonly status: "accepted" | "rejected" | "already_applied";
  readonly rejectionReason: string | null;
  readonly originalResultDigest: string | null;
  readonly authoritativeSourceRevision: number;
  readonly canonicalResultJson: string;
  readonly enqueuedAt: number;
}

export interface NormalizedPrimaryFollowerResultPage {
  readonly records: readonly NormalizedPrimaryFollowerResultRecord[];
  readonly nextCursor: Readonly<{
    actorId: string;
    resultSequence: number;
    resultDigest: string;
  }> | null;
  readonly done: boolean;
  readonly canonicalRecordBytes: number;
}

export async function readNormalizedPrimaryFollowerResultPage(input: {
  readonly actorId: string;
  readonly after: NormalizedPrimaryFollowerResultPage["nextCursor"];
}): Promise<NormalizedPrimaryFollowerResultPage> {
  return invoke<NormalizedPrimaryFollowerResultPage>(
    "read_normalized_library_follower_result_page",
    {
      request: {
        actorId: input.actorId,
        after: input.after,
        maximumRecords: 128,
        maximumResponseBytes: 1_048_576,
      },
    },
  );
}

async function readNormalizedLibraryFollowerMutationContext(): Promise<SqliteLibraryPrimaryMutationContext | null> {
  return invoke<SqliteLibraryPrimaryMutationContext | null>(
    "normalized_library_follower_mutation_context",
  );
}

async function signNormalizedLibraryFollowerOperation(input: {
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

async function enqueueNormalizedLibraryFollowerIntent(
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

async function finalizeSignedTransaction(
  context: SqliteLibraryMutationContext,
  members: Parameters<typeof assembleLibraryCoreTransactionV1>[0],
) {
  const assembled = assembleLibraryCoreTransactionV1(
    members,
    context.previousChainDigest as LibraryCoreLowercaseHex64,
    { digest: operationDigest },
  );
  const primarySignatures =
    context.mode === "primary"
      ? await invoke<readonly SqliteLibraryFollowerOperationSignature[]>(
          "sign_normalized_library_operations",
          {
            request: {
              libraryId: context.libraryId,
              epochId: context.epochId,
              actorId: context.actorId,
              actorPublicKey: context.actorPublicKey,
              operationSigningBodyDigests: assembled.members.map(
                (member) => member.signing_body_digest,
              ),
            },
          },
        )
      : null;
  if (
    primarySignatures !== null &&
    primarySignatures.length !== assembled.members.length
  ) {
    throw new Error("Primary signer returned the wrong signature count");
  }
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
      const signed = primarySignatures
        ? primarySignatures[signatureIndex - 1]
        : await signNormalizedLibraryFollowerOperation({
            libraryId: context.libraryId,
            epochId: context.epochId,
            actorId: context.actorId,
            actorPublicKey: context.actorPublicKey,
            operationSigningBodyDigest: member.signing_body_digest,
          });
      if (!signed)
        throw new Error("Primary signer omitted a transaction member");
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
  return { canonicalEnvelopeJson, finalized };
}

async function finalizeAndSubmitTransaction(
  context: SqliteLibraryMutationContext,
  members: Parameters<typeof assembleLibraryCoreTransactionV1>[0],
  committedAtMs: number,
): Promise<void> {
  const { canonicalEnvelopeJson, finalized } = await finalizeSignedTransaction(context, members);
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
  operationType: "feed_item_like_sync_receipt" | "feed_item_seen_sync_receipt",
  entityId: string,
  syncedAtMs: number,
): Promise<void> {
  const context = await primaryMutationContext();
  if (!context) {
    throw new Error(
      "Normalized SQLite Primary provider receipt context is required",
    );
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
  const batchLimit =
    LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_capture_upsert
      .maximumMembers;
  for (let start = 0; start < items.length; start += batchLimit) {
    const batchContext = context;
    const batch = items.slice(start, start + batchLimit);
    const transactionId =
      `desktop-library-capture:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((sourceItem, index) => {
      const item = sanitizeFeedItemCaptureWrite(sourceItem);
      return FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
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
      );
    });
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

type NormalizedAnnotationAssignment = Readonly<{
  entityId: string;
  highlights: ReturnType<typeof canonicalizeFeedItemHighlightsV1>;
  tags: readonly string[];
}>;

function annotationTransactionMembers(
  batchContext: SqliteLibraryMutationContext,
  batch: readonly NormalizedAnnotationAssignment[],
  transactionId: LibraryCoreOperationInstanceId,
  assignedAtMs: number,
) {
  return batch.map((assignment, index) =>
      FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
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
          entity_id: assignment.entityId,
          payload: {
            assigned_at_ms: assignedAtMs,
            highlights: assignment.highlights,
            tags: assignment.tags,
          },
          created_at_ms: assignedAtMs,
        } satisfies FeedItemAnnotationsReplaceTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
}

/** Preserve normalized annotations, including blob locators, without ordinary enqueue. */
export async function prepareDesktopRecoveryAnnotationTransaction(
  assignments: readonly NormalizedAnnotationAssignment[],
): Promise<readonly string[]> {
  if (assignments.length === 0 || assignments.length > 1000) throw new Error("Recovery transaction exceeds its bounds");
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-annotation-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const members = annotationTransactionMembers(context, assignments, transactionId, Date.now());
  return Object.freeze((await finalizeSignedTransaction(context, members)).canonicalEnvelopeJson);
}

async function maybeSubmitFeedItemAnnotationSets(
  input: readonly Readonly<{
    entityId: string;
    highlights: readonly Highlight[];
    tags: readonly string[];
  }>[],
  assignedAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const unique = new Map<
    string,
    Readonly<{
      highlights: ReturnType<typeof canonicalizeFeedItemHighlightsV1>;
      tags: ReturnType<typeof canonicalizeFeedItemTagsV1>;
    }>
  >();
  for (const assignment of input) {
    unique.set(assignment.entityId, {
      highlights: canonicalizeFeedItemHighlightsV1(assignment.highlights),
      tags: canonicalizeFeedItemTagsV1(assignment.tags),
    });
  }
  const assignments = [...unique].map(([entityId, annotations]) => ({
    entityId,
    ...annotations,
  }));
  if (assignments.length === 0) return true;
  const batchLimit =
    LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_annotations_replace
      .maximumMembers;
  for (let start = 0; start < assignments.length; start += batchLimit) {
    const batchContext = context;
    const batch = assignments.slice(start, start + batchLimit);
    const transactionId =
      `desktop-library-annotations:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = annotationTransactionMembers(batchContext, batch, transactionId, assignedAtMs);
    await finalizeAndSubmitTransaction(batchContext, members, assignedAtMs);
    if (start + batch.length < assignments.length) {
      context = await mutationContext();
      if (!context) {
        throw new Error(
          "Library mutation context changed during annotation commit",
        );
      }
    }
  }
  return true;
}

async function maybeSubmitFeedItemAnalysisSets(
  input: readonly Readonly<{
    contentSignals: FeedItem["contentSignals"];
    entityId: string;
    eventCandidate: FeedItem["eventCandidate"];
  }>[],
  assignedAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const unique = new Map<
    string,
    ReturnType<typeof canonicalizeFeedItemAnalysisV1>
  >();
  for (const assignment of input) {
    unique.set(
      assignment.entityId,
      canonicalizeFeedItemAnalysisV1(
        assignment.contentSignals,
        assignment.eventCandidate,
      ),
    );
  }
  const assignments = [...unique].map(([entityId, analysis]) => ({
    analysis,
    entityId,
  }));
  if (assignments.length === 0) return true;
  const batchLimit =
    LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_analysis_replace
      .maximumMembers;
  for (let start = 0; start < assignments.length; start += batchLimit) {
    const batchContext = context;
    const batch = assignments.slice(start, start + batchLimit);
    const transactionId =
      `desktop-library-analysis:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((assignment, index) =>
      FEED_ITEM_ANALYSIS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
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
          entity_id: assignment.entityId,
          payload: {
            assigned_at_ms: assignedAtMs,
            ...assignment.analysis,
          },
          created_at_ms: assignedAtMs,
        } satisfies FeedItemAnalysisReplaceTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, assignedAtMs);
    if (start + batch.length < assignments.length) {
      context = await mutationContext();
      if (!context) {
        throw new Error(
          "Library mutation context changed during analysis commit",
        );
      }
    }
  }
  return true;
}

export async function commitDesktopLibraryFeedItemAnalysisSets(
  assignments: readonly Readonly<{
    contentSignals: FeedItem["contentSignals"];
    entityId: string;
    eventCandidate: FeedItem["eventCandidate"];
  }>[],
  assignedAtMs: number,
): Promise<void> {
  if (!(await maybeSubmitFeedItemAnalysisSets(assignments, assignedAtMs))) {
    throw new Error("Normalized SQLite FeedItem analysis context is required");
  }
}

export async function commitDesktopLibraryFeedItemPriorities(
  assignments: readonly Readonly<{
    entityId: string;
    priorityBasisPoints: number;
  }>[],
  assignedAtMs: number,
): Promise<void> {
  let context = await mutationContext();
  if (!context) {
    throw new Error("Normalized SQLite FeedItem priority context is required");
  }
  const unique = new Map<string, number>();
  for (const assignment of assignments) {
    if (
      assignment.entityId.length === 0 ||
      !Number.isSafeInteger(assignment.priorityBasisPoints) ||
      assignment.priorityBasisPoints < 0 ||
      assignment.priorityBasisPoints > 10_000
    ) {
      throw new TypeError("FeedItem priority assignment is invalid");
    }
    unique.set(assignment.entityId, assignment.priorityBasisPoints);
  }
  const normalized = [...unique].map(([entityId, priorityBasisPoints]) => ({
    entityId,
    priorityBasisPoints,
  }));
  const batchLimit =
    LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_priority_assignment
      .maximumMembers;
  for (let start = 0; start < normalized.length; start += batchLimit) {
    const batchContext = context;
    const batch = normalized.slice(start, start + batchLimit);
    const transactionId =
      `desktop-library-priority:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = batch.map((assignment, index) =>
      FEED_ITEM_PRIORITY_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
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
          entity_id: assignment.entityId,
          payload: {
            assigned_at_ms: assignedAtMs,
            priority_basis_points: assignment.priorityBasisPoints,
          },
          created_at_ms: assignedAtMs,
        } satisfies FeedItemPriorityAssignmentTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
    await finalizeAndSubmitTransaction(batchContext, members, assignedAtMs);
    if (start + batch.length < normalized.length) {
      context = await mutationContext();
      if (!context) {
        throw new Error(
          "Library mutation context changed during priority commit",
        );
      }
    }
  }
}

function feedItemRemovalTransactionMembers(
  batchContext: SqliteLibraryMutationContext, batch: readonly string[],
  transactionId: LibraryCoreOperationInstanceId, removedAtMs: number,
) {
  return batch.map((entityId, index) =>
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
}

/** Sign the complete reviewed target set; native recovery owns atomic enqueue. */
export async function prepareDesktopRecoveryItemRemovalTransaction(
  entityIds: readonly string[], confirmed: boolean,
): Promise<readonly string[]> {
  if (!confirmed) throw new Error("Confirm item deletion before preparing this edit");
  if (entityIds.length === 0 || entityIds.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.feed_item_remove.maximumMembers)
    throw new Error("Recovery transaction exceeds its bounds");
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-item-removal-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const members = feedItemRemovalTransactionMembers(context, entityIds, transactionId, Date.now());
  const signed = await finalizeSignedTransaction(context, members);
  return Object.freeze(signed.canonicalEnvelopeJson);
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
    const members = feedItemRemovalTransactionMembers(batchContext, batch, transactionId, removedAtMs);
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
  const members = rssUpsertTransactionMembers(context, [feed], transactionId, createdAtMs);
  await finalizeAndSubmitTransaction(context, members, createdAtMs);
  return true;
}

function rssUpsertTransactionMembers(
  context: SqliteLibraryMutationContext, feeds: readonly RssFeed[],
  transactionId: LibraryCoreOperationInstanceId, createdAtMs: number,
) {
  return feeds.map((feed, index) => RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
    {
      operation_id: `${transactionId}:${index}`,
      library_id: context.libraryId,
      epoch: context.epoch,
      epoch_id: context.epochId,
      actor_id: context.actorId,
      actor_sequence: context.nextSequence + index,
      previous_actor_operation_id: index === 0 ? context.previousOperationId : `${transactionId}:${index - 1}`,
      causal_frontier: context.observedFrontier,
      hlc_wall_ms: createdAtMs,
      hlc_counter: index,
      transaction_id: transactionId,
      transaction_member_index: index,
      transaction_member_count: feeds.length,
      entity_id: feed.url,
      payload: { feed: synchronizedRssFeed(feed) },
      created_at_ms: createdAtMs,
    } satisfies RssFeedUpsertTransactionMemberInputV1,
    { digest: operationDigest },
  ));
}

/** Finalize one complete reviewed replacement; native linkage owns enqueue. */
export async function prepareDesktopRecoveryRssUpsertTransaction(feeds: readonly RssFeed[]): Promise<readonly string[]> {
  if (feeds.length === 0 || feeds.length > 1000) throw new Error("Recovery transaction exceeds its bounds");
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-rss-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, rssUpsertTransactionMembers(context, feeds, transactionId, Date.now()));
  return Object.freeze(signed.canonicalEnvelopeJson);
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
  for (
    let start = 0;
    start < uniqueUrls.length;
    start += FOLLOWER_ENTITY_BATCH_LIMIT
  ) {
    const batchContext = context;
    const batch = uniqueUrls.slice(start, start + FOLLOWER_ENTITY_BATCH_LIMIT);
    const transactionId =
      `desktop-library-rss-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = rssRemovalTransactionMembers(batchContext, batch, transactionId, removedAtMs, includeItems);
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

function rssRemovalTransactionMembers(
  batchContext: SqliteLibraryMutationContext,
  batch: readonly string[],
  transactionId: LibraryCoreOperationInstanceId,
  removedAtMs: number,
  includeItems: boolean,
) {
  const schema = includeItems
    ? RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA
    : RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA;
  return batch.map((url, index) =>
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
}

/** Sign one complete reviewed unsubscribe; native recovery owns atomic enqueue. */
export async function prepareDesktopRecoveryRssRemovalTransaction(
  urls: readonly string[], includeItems: boolean, confirmedDeleteItems: boolean,
): Promise<readonly string[]> {
  const program = includeItems ? LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.rss_feed_remove_with_items : LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.rss_feed_remove_keep_items;
  if (urls.length === 0 || urls.length > program.maximumMembers) throw new Error("Recovery transaction exceeds its bounds");
  if (includeItems && !confirmedDeleteItems) throw new Error("Confirm article deletion before preparing this unsubscribe");
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-rss-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const members = rssRemovalTransactionMembers(context, urls, transactionId, Date.now(), includeItems);
  const signed = await finalizeSignedTransaction(context, members);
  return Object.freeze(signed.canonicalEnvelopeJson);
}

function rssTitleTransactionMembers(
  batchContext: SqliteLibraryMutationContext,
  batch: readonly Readonly<{ title: string; url: string }>[],
  transactionId: LibraryCoreOperationInstanceId,
  assignedAtMs: number,
) {
  return batch.map((assignment, index) =>
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
}

/** Prepare the complete reviewed editor transaction without ordinary enqueue. */
export async function prepareDesktopRecoveryRssTitleTransaction(
  assignments: readonly Readonly<{ title: string; url: string }>[],
): Promise<readonly string[]> {
  if (assignments.length === 0 || assignments.length > 1000) throw new Error("Recovery transaction exceeds its bounds");
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-rss-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const members = rssTitleTransactionMembers(context, assignments, transactionId, Date.now());
  const signed = await finalizeSignedTransaction(context, members);
  return Object.freeze(signed.canonicalEnvelopeJson);
}

async function maybeSubmitRssFeedTitleAssignments(
  assignments: readonly Readonly<{
    readonly title: string;
    readonly url: string;
  }>[],
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
    const members = rssTitleTransactionMembers(batchContext, batch, transactionId, assignedAtMs);
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
  const synchronized = assertSupportedUserPreferenceWrite(updates);
  if (Object.keys(synchronized).length === 0) return true;
  const transactionId =
    `desktop-library-preferences:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  await finalizeAndSubmitTransaction(context, preferenceTransactionMembers(context,
    [encodeLibraryCoreFractionalNumbersV1(synchronized) as Readonly<Record<string, LibraryCoreCanonicalValue>>], transactionId, createdAtMs), createdAtMs);
  return true;
}

function preferenceTransactionMembers(context: SqliteLibraryMutationContext,
  patches: readonly Readonly<Record<string, LibraryCoreCanonicalValue>>[], transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return patches.map((updates, index) => PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({
    operation_id: `${transactionId}:${index}`,
    library_id: context.libraryId, epoch: context.epoch, epoch_id: context.epochId,
    actor_id: context.actorId, actor_sequence: context.nextSequence + index,
    previous_actor_operation_id: index === 0 ? context.previousOperationId : `${transactionId}:${index - 1}`,
    causal_frontier: context.observedFrontier, hlc_wall_ms: createdAtMs, hlc_counter: 0,
    transaction_id: transactionId, transaction_member_index: index, transaction_member_count: patches.length,
    entity_id: "preferences", payload: { updates }, created_at_ms: createdAtMs,
  } satisfies PreferencesLeafAssignmentTransactionMemberInputV1, { digest: operationDigest }));
}

/** Sign the complete reviewed wire patches; the recovery command owns atomic admission and linkage. */
export async function prepareDesktopRecoveryPreferenceTransaction(patches: readonly unknown[]): Promise<readonly string[]> {
  const selected = snapshotLibraryCoreRecoveryPreferencePatchesV1(patches);
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const now = Date.now(), transactionId = `desktop-library-preference-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, preferenceTransactionMembers(context, selected, transactionId, now));
  return Object.freeze(signed.canonicalEnvelopeJson);
}

function personUpsertTransactionMembers(
  context: SqliteLibraryMutationContext, persons: readonly Person[],
  transactionId: LibraryCoreOperationInstanceId, createdAtMs: number,
) {
  return persons.map((person, index) =>
      PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: context.libraryId,
          epoch: context.epoch,
          epoch_id: context.epochId,
          actor_id: context.actorId,
          actor_sequence: context.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? context.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: context.observedFrontier,
          hlc_wall_ms: createdAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: persons.length,
          entity_id: person.id,
          payload: {
            person: sanitizePersonRootWrite(person) as unknown as Record<
              string,
              LibraryCoreCanonicalValue
            >,
          },
          created_at_ms: createdAtMs,
        } satisfies PersonUpsertTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
}

/** Freeze the complete reviewed roots before key access; native recovery owns enqueue. */
export async function prepareDesktopRecoveryPersonTransaction(persons: readonly Person[]): Promise<readonly string[]> {
  if (persons.length === 0 || persons.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_upsert.maximumMembers)
    throw new Error("Recovery transaction exceeds its member bound");
  const selected = structuredClone(persons.map(person => sanitizePersonRootWrite(person))) as Person[];
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const now = Date.now();
  const transactionId = `desktop-library-person-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, personUpsertTransactionMembers(context,
    selected.map(person => ({ ...person, updatedAt: now })), transactionId, now));
  return Object.freeze(signed.canonicalEnvelopeJson);
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
    const members = personUpsertTransactionMembers(batchContext, batch, transactionId, createdAtMs);
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

export async function upsertSqliteLibraryPerson(
  person: Person,
  createdAtMs = Date.now(),
): Promise<void> {
  if (!(await maybeSubmitPersonUpserts([person], createdAtMs))) {
    throw new Error("Library mutation context is unavailable");
  }
}

export async function upsertSqliteLibraryPersons(
  persons: readonly Person[],
  createdAtMs = Date.now(),
): Promise<void> {
  if (!(await maybeSubmitPersonUpserts(persons, createdAtMs))) {
    throw new Error("Library mutation context is unavailable");
  }
}

export async function appendSqliteLibraryPersonReachOut(
  personId: string,
  entry: ReachOutLog,
  createdAtMs = Date.now(),
): Promise<void> {
  const context = await mutationContext();
  if (!context) {
    throw new Error("Library mutation context is unavailable");
  }
  const synchronized = sanitizeReachOutLogWrite(entry);
  const transactionId =
    `desktop-library-person-reach-out:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  await finalizeAndSubmitTransaction(context, reachOutTransactionMembers(context, [{ personId, event: {
    channel: synchronized.channel ?? null, logged_at_ms: synchronized.loggedAt ?? entry.loggedAt, notes: synchronized.notes ?? null,
  } }], transactionId, createdAtMs), createdAtMs);
}

function reachOutTransactionMembers(context: SqliteLibraryMutationContext,
  entries: readonly { personId: string; event: RecoveryReachOutDraft["event"] }[],
  transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return entries.map(({ personId, event }, index) => PERSON_REACH_OUT_APPEND_TRANSACTION_MEMBER_SCHEMA.construct(
    {
      operation_id: `${transactionId}:${index}`,
      library_id: context.libraryId,
      epoch: context.epoch,
      epoch_id: context.epochId,
      actor_id: context.actorId,
      actor_sequence: context.nextSequence + index,
      previous_actor_operation_id: index === 0 ? context.previousOperationId : `${transactionId}:${index - 1}`,
      causal_frontier: context.observedFrontier,
      hlc_wall_ms: createdAtMs,
      hlc_counter: index,
      transaction_id: transactionId,
      transaction_member_index: index,
      transaction_member_count: entries.length,
      entity_id: personId,
      payload: event,
      created_at_ms: createdAtMs,
    } satisfies PersonReachOutAppendTransactionMemberInputV1,
    { digest: operationDigest },
  ));
}

/** Preserve the historical event time while signing a fresh explicit action. */
export async function prepareDesktopRecoveryReachOutTransaction(drafts: readonly RecoveryReachOutDraft[]): Promise<readonly string[]> {
  if (!drafts.length || drafts.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_reach_out_append.maximumMembers) throw new Error("Recovery exceeds its member bound");
  const selected = drafts.map(draft => {
    const payload = PERSON_REACH_OUT_APPEND_PAYLOAD_SCHEMA.validate(draft.event);
    if (!payload.ok) throw new Error("Reach-out event is invalid");
    return { personId: draft.personId, event: structuredClone(payload.value) };
  });
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const now = Date.now(), transactionId = `desktop-library-reach-out-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, reachOutTransactionMembers(context, selected, transactionId, now));
  return Object.freeze(signed.canonicalEnvelopeJson);
}

export async function assignSqliteLibraryAccountToPerson(
  accountId: string,
  personId: string | null,
  assignedAtMs = Date.now(),
): Promise<void> {
  const context = await mutationContext();
  if (!context) {
    throw new Error("Library mutation context is unavailable");
  }
  const transactionId = `desktop-library-account-person:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  await finalizeAndSubmitTransaction(context, accountPersonTransactionMembers(context, [{ accountId, personId }], transactionId, assignedAtMs), assignedAtMs);
}

function accountPersonTransactionMembers(context: SqliteLibraryMutationContext,
  assignments: readonly { accountId: string; personId: string | null }[],
  transactionId: LibraryCoreOperationInstanceId, assignedAtMs: number,
) {
  return assignments.map(({ accountId, personId }, index) => ACCOUNT_PERSON_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({
    operation_id: `${transactionId}:${index}`, library_id: context.libraryId, epoch: context.epoch,
    epoch_id: context.epochId, actor_id: context.actorId, actor_sequence: context.nextSequence + index,
    previous_actor_operation_id: index === 0 ? context.previousOperationId : `${transactionId}:${index - 1}`,
    causal_frontier: context.observedFrontier, hlc_wall_ms: assignedAtMs, hlc_counter: index,
    transaction_id: transactionId, transaction_member_index: index, transaction_member_count: assignments.length,
    entity_id: accountId, payload: { assigned_at_ms: assignedAtMs, person_id: personId }, created_at_ms: assignedAtMs,
  } satisfies AccountPersonAssignmentTransactionMemberInputV1, { digest: operationDigest }));
}

/** Sign the whole reviewed target set; only recovery submission may enqueue it. */
export async function prepareDesktopRecoveryAccountPersonTransaction(
  assignments: readonly { accountId: string; personId: string | null }[],
): Promise<readonly string[]> {
  if (assignments.length === 0 || assignments.length > 1000) throw new Error("Recovery transaction exceeds its member bound");
  const selected = assignments.map(({ accountId, personId }) => ({ accountId, personId }));
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-account-person-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, accountPersonTransactionMembers(context, selected, transactionId, Date.now()));
  return Object.freeze(signed.canonicalEnvelopeJson);
}

function friendReplacementMember(
  context: SqliteLibraryMutationContext, person: Person, accounts: readonly Account[],
  transactionId: LibraryCoreOperationInstanceId, createdAtMs: number,
) {
  return FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
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
      entity_id: person.id,
      payload: {
        accounts: accounts as unknown as readonly Readonly<
          Record<string, LibraryCoreCanonicalValue>
        >[],
        person: person as unknown as Readonly<
          Record<string, LibraryCoreCanonicalValue>
        >,
      },
      created_at_ms: createdAtMs,
    } satisfies FriendReplaceTransactionMemberInputV1,
    { digest: operationDigest },
  );
}

/** Sign one explicit Friend replacement; the recovery boundary owns its durable enqueue. */
export async function prepareDesktopRecoveryFriendTransaction(person: Person, accounts: readonly Account[]): Promise<readonly string[]> {
  // Snapshot before key access, preserving every selected field and rejecting an
  // invalid whole payload instead of sanitizing away unknown archived details.
  const selected = FRIEND_REPLACE_PAYLOAD_SCHEMA.validate({ accounts: [...accounts].sort((a, b) => compareLibraryCoreUtf8V1(a.id, b.id)), person });
  if (!selected.ok) throw new Error("The complete Friend replacement is invalid or oversized");
  const snapshot = structuredClone(selected.value);
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const now = Date.now();
  const transactionId = `desktop-library-friend-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const member = friendReplacementMember(context,
    { ...snapshot.person, updatedAt: now } as unknown as Person,
    snapshot.accounts.map(account => ({ ...account, updatedAt: now })) as unknown as Account[], transactionId, now);
  const signed = await finalizeSignedTransaction(context, [member]);
  return Object.freeze(signed.canonicalEnvelopeJson);
}

export async function replaceSqliteLibraryFriend(
  person: Person,
  desiredAccounts: readonly Account[],
  createdAtMs = Date.now(),
): Promise<void> {
  if (
    desiredAccounts.length > FRIEND_REPLACE_MAXIMUM_ACCOUNTS ||
    desiredAccounts.some((account) => account.personId !== person.id)
  ) {
    throw new RangeError("Friend Account window is invalid");
  }
  const context = await mutationContext();
  if (!context) {
    throw new Error("Library mutation context is unavailable");
  }
  const currentPerson = await readNormalizedPerson(person.id);
  const resolvedPerson = sanitizePersonRootWrite({
    ...currentPerson,
    ...person,
    createdAt: currentPerson?.createdAt ?? person.createdAt,
    updatedAt: createdAtMs,
  });
  const resolvedAccounts = await Promise.all(
    desiredAccounts.map(async (desired) => {
      const current = await readNormalizedAccount(desired.id);
      return sanitizeAccountWrite({
        ...current,
        ...desired,
        personId: person.id,
        createdAt: current?.createdAt ?? desired.createdAt,
        firstSeenAt: current
          ? Math.min(current.firstSeenAt, desired.firstSeenAt)
          : desired.firstSeenAt,
        lastSeenAt: current
          ? Math.max(current.lastSeenAt, desired.lastSeenAt)
          : desired.lastSeenAt,
        updatedAt: createdAtMs,
      }) as Account;
    }),
  );
  resolvedAccounts.sort((left, right) => compareLibraryCoreUtf8V1(left.id, right.id));
  if (
    new Set(resolvedAccounts.map((account) => account.id)).size !==
    resolvedAccounts.length
  ) {
    throw new TypeError("Friend Account window contains duplicate IDs");
  }
  const transactionId =
    `desktop-library-friend-replace:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const member = friendReplacementMember(context, resolvedPerson as Person, resolvedAccounts, transactionId, createdAtMs);
  await finalizeAndSubmitTransaction(context, [member], createdAtMs);
}

async function maybeSubmitPersonRemove(
  personId: string,
  removedAtMs: number,
): Promise<boolean> {
  return maybeSubmitPersonRemoves([personId], removedAtMs);
}

function personRemovalTransactionMembers(
  context: SqliteLibraryMutationContext, personIds: readonly string[],
  transactionId: LibraryCoreOperationInstanceId, removedAtMs: number,
) {
  return personIds.map((personId, index) =>
      PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: context.libraryId,
          epoch: context.epoch,
          epoch_id: context.epochId,
          actor_id: context.actorId,
          actor_sequence: context.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? context.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: context.observedFrontier,
          hlc_wall_ms: removedAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: personIds.length,
          entity_id: personId,
          payload: { removed_at_ms: removedAtMs },
          created_at_ms: removedAtMs,
        } satisfies PersonRemoveTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
}

/** Sign fixed ordered targets; recovery owns the durable intent and link commit. */
export async function prepareDesktopRecoveryPersonRemovalTransaction(
  personIds: readonly string[], confirmed: boolean,
): Promise<readonly string[]> {
  if (!confirmed) throw new Error("Confirm people and linked account deletion before preparing this edit");
  if (personIds.length === 0 || personIds.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_remove_and_accounts.maximumMembers)
    throw new Error("Recovery transaction exceeds its bounds");
  const targets = [...personIds];
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-person-removal-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, personRemovalTransactionMembers(context, targets, transactionId, Date.now()));
  return Object.freeze(signed.canonicalEnvelopeJson);
}

async function maybeSubmitPersonRemoves(
  personIds: readonly string[],
  removedAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const uniqueIds = [...new Set(personIds)];
  if (uniqueIds.length === 0) return true;
  const batchLimit =
    LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.person_remove_and_accounts
      .maximumMembers;
  for (let start = 0; start < uniqueIds.length; start += batchLimit) {
    const batchContext = context;
    const batch = uniqueIds.slice(start, start + batchLimit);
    const transactionId =
      `desktop-library-person-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = personRemovalTransactionMembers(batchContext, batch, transactionId, removedAtMs);
    await finalizeAndSubmitTransaction(batchContext, members, removedAtMs);
    if (start + batch.length < uniqueIds.length) {
      context = await mutationContext();
      if (!context) {
        throw new Error(
          "Library mutation context changed during Person removal",
        );
      }
    }
  }
  return true;
}

export async function removeSqliteLibraryPerson(
  personId: string,
  removedAtMs = Date.now(),
): Promise<void> {
  if (!(await maybeSubmitPersonRemove(personId, removedAtMs))) {
    throw new Error("Library mutation context is unavailable");
  }
}

function accountUpsertTransactionMembers(context: SqliteLibraryMutationContext, accounts: readonly Account[],
  transactionId: LibraryCoreOperationInstanceId, createdAtMs: number) {
  return accounts.map((account, index) =>
      ACCOUNT_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: context.libraryId,
          epoch: context.epoch,
          epoch_id: context.epochId,
          actor_id: context.actorId,
          actor_sequence: context.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? context.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: context.observedFrontier,
          hlc_wall_ms: createdAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: accounts.length,
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
}

/** Freeze the reviewed complete roots before signing; recovery owns enqueue. */
export async function prepareDesktopRecoveryAccountTransaction(accounts: readonly Account[], review: LibraryCoreRecoveryIntentReviewResponseV1): Promise<readonly string[]> {
  if (!accounts.length || accounts.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_upsert.maximumMembers)
    throw new Error("Recovery transaction exceeds its member bound");
  const selected = structuredClone(accounts.map(account => sanitizeAccountWrite(account))) as Account[];
  for (const account of selected) {
    if (!account.personId) continue;
    const current = await queryNormalizedLibrary({ queryId: "person_detail_v1", schemaVersion: 1, personId: account.personId });
    if (!current.person || current.person.id !== account.personId || current.source.generationId !== review.source.generationId || current.source.projectionRevision !== review.source.projectionRevision)
      throw new Error("The selected person or Library changed. Review the Account details again.");
  }
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const now = Date.now();
  const transactionId = `desktop-library-account-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, accountUpsertTransactionMembers(context, selected.map(account => ({ ...account, updatedAt: now })), transactionId, now));
  return Object.freeze(signed.canonicalEnvelopeJson);
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
    const members = accountUpsertTransactionMembers(batchContext, batch, transactionId, createdAtMs);
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

export async function upsertSqliteLibraryAccount(
  account: Account,
  createdAtMs = Date.now(),
): Promise<void> {
  if (!(await maybeSubmitAccountUpserts([account], createdAtMs))) {
    throw new Error("Library mutation context is unavailable");
  }
}

export async function upsertSqliteLibraryAccounts(
  accounts: readonly Account[],
  createdAtMs = Date.now(),
): Promise<void> {
  if (!(await maybeSubmitAccountUpserts(accounts, createdAtMs))) {
    throw new Error("Library mutation context is unavailable");
  }
}

function accountRemovalTransactionMembers(
  context: SqliteLibraryMutationContext, accountIds: readonly string[],
  transactionId: LibraryCoreOperationInstanceId, removedAtMs: number,
) {
  return accountIds.map((accountId, index) =>
      ACCOUNT_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: context.libraryId,
          epoch: context.epoch,
          epoch_id: context.epochId,
          actor_id: context.actorId,
          actor_sequence: context.nextSequence + index,
          previous_actor_operation_id:
            index === 0
              ? context.previousOperationId
              : `${transactionId}:${index - 1}`,
          causal_frontier: context.observedFrontier,
          hlc_wall_ms: removedAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: accountIds.length,
          entity_id: accountId,
          payload: { removed_at_ms: removedAtMs },
          created_at_ms: removedAtMs,
        } satisfies AccountRemoveTransactionMemberInputV1,
        { digest: operationDigest },
      ),
    );
}

/** Sign the complete original Account target set without ordinary enqueue. */
export async function prepareDesktopRecoveryAccountRemovalTransaction(
  accountIds: readonly string[], confirmed: boolean,
): Promise<readonly string[]> {
  if (!confirmed) throw new Error("Confirm account deletion before preparing this edit");
  if (accountIds.length === 0 || accountIds.length > LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_remove.maximumMembers)
    throw new Error("Recovery transaction exceeds its bounds");
  const targets = [...accountIds];
  const context = await mutationContext(false);
  if (!context || context.mode !== "follower") throw new Error("Recovery requires an enrolled consumer");
  const transactionId = `desktop-library-account-removal-recovery:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const signed = await finalizeSignedTransaction(context, accountRemovalTransactionMembers(context, targets, transactionId, Date.now()));
  return Object.freeze(signed.canonicalEnvelopeJson);
}

async function maybeSubmitAccountRemoves(
  accountIds: readonly string[],
  removedAtMs: number,
): Promise<boolean> {
  let context = await mutationContext();
  if (!context) return false;
  const uniqueIds = [...new Set(accountIds)];
  if (uniqueIds.length === 0) return true;
  const batchLimit =
    LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS.account_remove.maximumMembers;
  for (let start = 0; start < uniqueIds.length; start += batchLimit) {
    const batchContext = context;
    const batch = uniqueIds.slice(start, start + batchLimit);
    const transactionId =
      `desktop-library-account-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = accountRemovalTransactionMembers(batchContext, batch, transactionId, removedAtMs);
    await finalizeAndSubmitTransaction(batchContext, members, removedAtMs);
    if (start + batch.length < uniqueIds.length) {
      context = await mutationContext();
      if (!context) {
        throw new Error(
          "Library mutation context changed during Account removal",
        );
      }
    }
  }
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

export interface NormalizedLocalSnapshotSummary {
  snapshotId: string;
  createdAtMs: number;
  reason: "auto" | "manual";
  libraryId: string;
  authorityEpoch: string;
  sourceRevision: number;
  itemCount: number;
  recordCount: number;
  canonicalRecordBytes: number;
  archiveByteLength: number;
  checkpointDigest: string;
}

export interface NormalizedLocalSnapshotRestoreRequest {
  operationId: string;
  restoredAtMs: number;
}

let sqliteActive = false;

export function isSqliteLibraryActive(): boolean {
  return sqliteActive;
}

export async function ensureFreshNormalizedDesktopLibrary(
  historicalDataAbsent: boolean,
): Promise<boolean> {
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") return false;
  return invoke<boolean>("ensure_fresh_normalized_desktop_library", {
    historicalDataAbsent,
  });
}

export async function describeNormalizedLibraryOperationExport() {
  return parseLibraryCoreNormalizedOperationExportDescriptorV2(
    await invoke<unknown>("describe_normalized_library_operation_export"),
  );
}

export async function readNormalizedLibraryOperationPage(request: LibraryCoreNormalizedOperationExportRequestV2) {
  return parseLibraryCoreNormalizedOperationExportPageV2(
    await invoke<unknown>("read_normalized_library_operation_page", {
      request: parseLibraryCoreNormalizedOperationExportRequestV2(request),
    }),
  );
}

export async function importNormalizedLibraryOperationPage(request: LibraryCoreNormalizedOperationImportPageV2) {
  return parseLibraryCoreNormalizedOperationImportReceiptV2(
    await invoke<unknown>("import_normalized_library_operation_page", {
      request: parseLibraryCoreNormalizedOperationImportPageV2(request),
    }),
  );
}

export async function describeNormalizedLibraryCheckpoint(): Promise<LibraryCoreNormalizedCheckpointExportDescriptorV2> {
  return parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    await invoke<unknown>("describe_normalized_library_checkpoint"),
  );
}

/** Begin one pinned checkpoint export and return its exact read-transaction descriptor. */
export async function beginNormalizedLibraryCheckpointExport(handoffId?: string): Promise<LibraryCoreNormalizedCheckpointExportDescriptorV2> {
  if (handoffId !== undefined && !HEX_64.test(handoffId)) throw new TypeError("Invalid handoff identity");
  return parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    await (handoffId === undefined
      ? invoke<unknown>("begin_normalized_library_checkpoint_export")
      : invoke<unknown>("begin_normalized_library_checkpoint_export", { handoffId })),
  );
}

export interface NormalizedLibraryConsumerRecoverySummary {
  readonly recoveryId: string;
  readonly libraryId: string;
  readonly predecessorEpochId: string;
  readonly successorEpochId: string;
  readonly state: "archived" | "prepared" | "following";
  readonly archivedPendingEdits: number;
  readonly archivedPublishedEdits: number;
}

function parseConsumerRecoverySummary(value: unknown): NormalizedLibraryConsumerRecoverySummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid consumer recovery summary");
  const row = value as Record<string, unknown>;
  const ids = ["recoveryId", "libraryId", "predecessorEpochId", "successorEpochId"] as const;
  const counts = ["archivedPendingEdits", "archivedPublishedEdits"] as const;
  if (Object.keys(row).length !== 7 || ids.some((key) => typeof row[key] !== "string" || !HEX_64.test(row[key] as string))
    || counts.some((key) => !Number.isSafeInteger(row[key]) || (row[key] as number) < 0)
    || !["archived", "prepared", "following"].includes(row.state as string)) {
    throw new TypeError("Invalid consumer recovery summary");
  }
  return row as unknown as NormalizedLibraryConsumerRecoverySummary;
}

export async function readNormalizedLibraryConsumerRecovery(): Promise<NormalizedLibraryConsumerRecoverySummary | null> {
  const value = await invoke<unknown>("read_normalized_library_consumer_recovery");
  return value === null ? null : parseConsumerRecoverySummary(value);
}

export async function prepareNormalizedLibraryConsumerRecovery(): Promise<NormalizedLibraryConsumerRecoverySummary> {
  return parseConsumerRecoverySummary(await invoke<unknown>("prepare_normalized_library_consumer_recovery"));
}

export async function commitNormalizedLibraryConsumerRecovery(recoveryId: string): Promise<NormalizedLibraryConsumerRecoverySummary> {
  if (!HEX_64.test(recoveryId)) throw new TypeError("Invalid consumer recovery identity");
  return parseConsumerRecoverySummary(await invoke<unknown>("commit_normalized_library_consumer_recovery", { recoveryId }));
}

export interface NormalizedLibraryHandoffStatus {
  readonly handoffId: string;
  readonly libraryId: string;
  readonly installationRole: "source" | "target" | "consumer";
  readonly phase: "preparing" | "sealed" | "authorized" | "cas_pending" | "committed" | "active" | "demoted" | "cancelled" | "recovery" | "following";
  readonly predecessorEpochId: string;
  readonly successorEpochId: string | null;
  readonly canonicalReadiness: string;
  readonly canonicalAuthorizationBody: string | null;
  readonly canonicalAuthorization: string | null;
  readonly canonicalActivation: string | null;
  readonly canonicalCancellation?: string | null;
  readonly expectedControlRevision: string | null;
  readonly observedControlRevision: string | null;
  readonly updatedAtMs: number;
}

/** Native validates the persisted schema and bounded canonical recovery receipts. */
export function readNormalizedLibraryHandoffStatus(): Promise<NormalizedLibraryHandoffStatus | null> {
  return invoke("read_normalized_library_handoff_status");
}

export function prepareNormalizedLibraryHandoffReadiness(): Promise<string> {
  return invoke("prepare_normalized_library_handoff_readiness", { createdAtMs: Date.now() });
}

export function beginNormalizedLibrarySourceHandoff(canonicalReadiness: string, selectedTargetActorId: string): Promise<string> {
  return invoke("begin_normalized_library_source_handoff", {
    canonicalReadiness, selectedTargetActorId, preparedAtMs: Date.now(),
  });
}

export async function sealNormalizedLibrarySourceHandoff(
  handoffId: string,
  expected: LibraryCoreNormalizedCheckpointExportDescriptorV2,
): Promise<LibraryCoreNormalizedCheckpointExportDescriptorV2> {
  return parseLibraryCoreNormalizedCheckpointExportDescriptorV2(await invoke("seal_normalized_library_source_handoff", {
    handoffId, expected, sealedAtMs: Date.now(),
  }));
}

export function cancelNormalizedLibrarySourceHandoff(handoffId: string): Promise<void> {
  return invoke("cancel_normalized_library_source_handoff", { handoffId, cancelledAtMs: Date.now() });
}

export function prepareNormalizedLibraryHandoffAuthorization(
  handoffId: string, canonicalControl: string, controlRevision: string, controlFileId: string,
): Promise<string> {
  return invoke("prepare_normalized_library_handoff_authorization", { handoffId, canonicalControl, controlRevision, controlFileId });
}

export function authorizeNormalizedLibrarySourceHandoff(handoffId: string, canonicalBody: string): Promise<string> {
  return invoke("authorize_normalized_library_source_handoff", { handoffId, canonicalBody, authorizedAtMs: Date.now() });
}

export function prepareNormalizedLibraryHandoffActivation(handoffId: string, controlFileId: string, canonicalControl: string): Promise<string> {
  if (!HEX_64.test(handoffId)) throw new TypeError("Invalid handoff identity");
  return invoke("prepare_normalized_library_handoff_activation", { handoffId, controlFileId, canonicalControl, preparedAtMs: Date.now() });
}

export function adoptNormalizedLibrarySourceHandoff(input: {
  handoffId: string; stageId: string; canonicalControl: string; accessToken: string;
}): Promise<NormalizedLibraryHandoffStatus> {
  if (!HEX_64.test(input.handoffId) || !input.stageId || input.stageId.length > 255) throw new TypeError("Invalid source adoption identity");
  return invoke("adopt_normalized_library_source_handoff", input);
}

export function activateNormalizedLibraryTargetHandoff(handoffId: string, accessToken: string): Promise<NormalizedLibraryHandoffStatus> {
  if (!HEX_64.test(handoffId)) throw new TypeError("Invalid handoff identity");
  return invoke("activate_normalized_library_target_handoff", { handoffId, accessToken });
}

export function stageNormalizedLibraryTargetHandoff(handoffId: string): Promise<string> {
  if (!HEX_64.test(handoffId)) throw new TypeError("Invalid handoff identity");
  return invoke("stage_normalized_library_target_handoff", { handoffId, stagedAtMs: Date.now() });
}

export function acceptNormalizedLibraryTargetHandoffCancellation(canonicalCancellation: string): Promise<string> {
  return invoke("accept_normalized_library_target_handoff_cancellation", { canonicalCancellation, appliedAtMs: Date.now() });
}

export function acceptNormalizedLibraryTargetHandoffAuthorization(canonicalAuthorization: string): Promise<string> {
  return invoke("accept_normalized_library_target_handoff_authorization", { canonicalAuthorization, acceptedAtMs: Date.now() });
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
  readonly handoffId?: string;
}): Promise<LibraryCoreNormalizedCheckpointExportPageV2> {
  if (input.handoffId !== undefined && !HEX_64.test(input.handoffId)) throw new TypeError("Invalid handoff identity");
  return parseLibraryCoreNormalizedCheckpointExportPageV2(
    await invoke<unknown>("read_normalized_library_checkpoint_page", {
      ...(input.handoffId === undefined ? {} : { handoffId: input.handoffId }),
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
    await invoke<unknown>("append_normalized_library_checkpoint_import_page", {
      request,
    }),
  );
}

export async function prepareNormalizedLibraryPredecessorCheckpointRead(stageId: string) {
  const request = createLibraryCoreSqlitePredecessorReadWorkerRequest("native-predecessor-read", stageId);
  if (request.kind !== "prepare_predecessor_checkpoint_read") throw new Error("invalid predecessor read request");
  return parseLibraryCorePredecessorCheckpointReadV1(await invoke<unknown>(
    "prepare_normalized_library_predecessor_checkpoint_read", { request: { stageId: request.stageId } },
  ));
}

export async function activateNormalizedLibraryPredecessorCheckpoint(
  activation: LibraryCoreActivateNormalizedCheckpointStageV2, successorStageId: string,
): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2> {
  const request = createLibraryCoreSqliteActivatePredecessorWorkerRequest("native-predecessor-import", activation, successorStageId);
  if (request.kind !== "activate_verified_predecessor_checkpoint") throw new Error("invalid predecessor import request");
  return parseLibraryCoreNormalizedCheckpointActivationReceiptV2(await invoke<unknown>(
    "activate_normalized_library_predecessor_checkpoint", { request: { stageId: request.activation.stageId,
      successorStageId: request.successorStageId, followerReceipt: request.activation.followerReceipt } },
  ));
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

const HEX_64 = /^[a-f0-9]{64}$/;

export async function loadSqliteLibraryState(): Promise<LibraryCoreRuntimeStateV1> {
  const [facets, preferences] = await Promise.all([
    queryNormalizedLibrary({
      queryId: LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
      schemaVersion: LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
    }),
    readLibraryCoreNormalizedPreferencesV1(NORMALIZED_MUTATION_READER_RUNTIME),
  ]);
  sqliteActive = true;
  return libraryCoreRuntimeStateFromFacetSummaryV1(
    preferences,
    facets.summary,
    facets.source.projectionRevision,
  );
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
  const candidates = uniqueByIdentity(items, (item) => item.globalId);
  const existing = new Set(
    (await readSqliteItems(candidates.map((item) => item.globalId))).map(
      (item) => item.globalId,
    ),
  );
  const missing = candidates.filter((item) => !existing.has(item.globalId));
  if (!(await maybeSubmitFeedItemCaptures(missing, Date.now()))) {
    throw new Error("Normalized SQLite FeedItem mutation context is required");
  }
  const annotated = missing.filter(
    (item) =>
      item.userState.tags.length > 0 ||
      (item.userState.highlights?.length ?? 0) > 0,
  );
  if (
    !(await maybeSubmitFeedItemAnnotationSets(
      annotated.map((item) => ({
        entityId: item.globalId,
        highlights: item.userState.highlights ?? [],
        tags: item.userState.tags,
      })),
      Date.now(),
    ))
  ) {
    throw new Error(
      "Normalized SQLite FeedItem annotation context is required",
    );
  }
  const analyzed = missing.filter(
    (item) =>
      item.contentSignals !== undefined || item.eventCandidate !== undefined,
  );
  if (
    !(await maybeSubmitFeedItemAnalysisSets(
      analyzed.map((item) => ({
        contentSignals: item.contentSignals,
        entityId: item.globalId,
        eventCandidate: item.eventCandidate,
      })),
      Date.now(),
    ))
  ) {
    throw new Error("Normalized SQLite FeedItem analysis context is required");
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
    throw new Error("Normalized SQLite FeedItem mutation context is required");
  }
  const analyzed = merged.filter(
    (_, index) =>
      items[index]?.contentSignals !== undefined ||
      items[index]?.eventCandidate !== undefined,
  );
  if (
    !(await maybeSubmitFeedItemAnalysisSets(
      analyzed.map((item) => ({
        contentSignals: item.contentSignals,
        entityId: item.globalId,
        eventCandidate: item.eventCandidate,
      })),
      Date.now(),
    ))
  ) {
    throw new Error("Normalized SQLite FeedItem analysis context is required");
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
  const response = await queryNormalizedLibrary({ personId, queryId: "person_root_v1", schemaVersion: 1 });
  return response.person as unknown as Person | null;
}

async function readNormalizedAccount(
  accountId: string,
): Promise<Account | null> {
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
    ...(account.profileUrl === null ? {} : { profileUrl: account.profileUrl }),
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
  changedIds: readonly string[],
): Promise<{
  state: LibraryCoreRuntimeStateV1;
  changedItems: FeedItem[];
}> {
  const changedItems: FeedItem[] = [];
  for (const globalId of changedIds) {
    const item = await readLibraryCoreNormalizedItemDetailV1(
      NORMALIZED_MUTATION_READER_RUNTIME,
      globalId,
    );
    if (item) changedItems.push(item);
  }
  return {
    state: await loadSqliteLibraryState(),
    changedItems,
  };
}

/** Commit one resolved sample-data plan in bounded transactions. */
export async function commitDesktopLibrarySampleRemovalPlan(
  plan: Readonly<{
    feedUrls: readonly string[];
    itemIds: readonly string[];
    personIds: readonly string[];
    realLinkedAccounts: readonly Account[];
    sampleAccountIds: readonly string[];
  }>,
  removedAtMs: number,
): Promise<void> {
  if (
    !(await maybeSubmitAccountUpserts(
      plan.realLinkedAccounts.map(({ personId, ...account }) => {
        void personId;
        return { ...account, updatedAt: removedAtMs };
      }),
      removedAtMs,
    ))
  ) {
    throw new Error("Normalized SQLite Account mutation context changed");
  }
  if (!(await maybeSubmitFeedItemRemoves(plan.itemIds, removedAtMs))) {
    throw new Error("Normalized SQLite item mutation context changed");
  }
  if (!(await maybeSubmitRssFeedRemoves(plan.feedUrls, false, removedAtMs))) {
    throw new Error("Normalized SQLite RSS Feed mutation context changed");
  }
  // Remove explicit sample Accounts first. Person removal also deletes linked
  // Accounts, after which an Account tombstone could no longer be admitted.
  if (!(await maybeSubmitAccountRemoves(plan.sampleAccountIds, removedAtMs))) {
    throw new Error("Normalized SQLite Account mutation context changed");
  }
  if (!(await maybeSubmitPersonRemoves(plan.personIds, removedAtMs))) {
    throw new Error("Normalized SQLite Person mutation context changed");
  }
}

export async function dispatchSqliteMutation(
  message: LibraryMutationRequest,
): Promise<{
  state: LibraryCoreRuntimeStateV1;
  event: LibraryMutationEvent;
  result?: unknown;
}> {
  const timestamp = Date.now();
  let changedIds: string[] = [];
  let source: LibraryMutationEvent["source"] = "state_update";
  let result: unknown;
  const saveDiscoveredAccounts = async (items: readonly FeedItem[]) => {
    const candidates = buildDiscoveredAccountsFromItems([...items], {});
    const missing: Account[] = [];
    for (const candidate of candidates) {
      if (!(await readNormalizedAccount(candidate.id))) missing.push(candidate);
    }
    if (missing.length === 0) return;
    if (!(await maybeSubmitAccountUpserts(missing, timestamp))) {
      throw new Error("Normalized SQLite Account mutation context is required");
    }
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
      if (message.type === "BATCH_IMPORT_ITEMS") result = [...changedIds];
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
        const existing = await readNormalizedAccount(account.id);
        if (
          !existing &&
          !account.personId &&
          message.type === "RECONCILE_FOLLOW_ROSTER_CAPTURE"
        ) {
          const person = buildConnectionPersonDraftFromAccounts(
            { [account.id]: account },
            [account.id],
            timestamp,
          );
          // Recapture must not reuse a prior draft to replace an edited Person
          // or reattach an Account the owner previously removed.
          if (person && !(await readNormalizedPerson(person.id))) {
            const linked = { ...account, personId: person.id };
            await replaceSqliteLibraryFriend(person, [linked], timestamp);
            reconciled.set(account.id, linked);
            continue;
          }
        }
        reconciled.set(
          account.id,
          existing ? { ...existing, ...account } : account,
        );
      }
      if (
        message.type === "RECONCILE_YOUTUBE_CAPTURE" &&
        message.options.rosterComplete
      ) {
        await scanLibraryCoreAccountRowsV1(
          NORMALIZED_MUTATION_READER_RUNTIME,
          async (rows) => {
            for (const row of rows) {
              if (
                row.provider !== "youtube" ||
                row.discoveredFrom !== "follow_roster" ||
                incomingIds.has(row.id)
              ) {
                continue;
              }
              const account = await readNormalizedAccount(row.id);
              if (account) {
                reconciled.set(row.id, {
                  ...account,
                  followRosterActive: false,
                  followRosterSyncedAt: message.options.capturedAt,
                  updatedAt: message.options.capturedAt,
                });
              }
            }
            return "continue" as const;
          },
        );
      }
      if (
        !(await maybeSubmitAccountUpserts([...reconciled.values()], timestamp))
      ) {
        throw new Error(
          "Normalized SQLite Account mutation context is required",
        );
      }
      changedIds = merged.map((item) => item.globalId);
      break;
    }
    case "ADD_SAMPLE_LIBRARY_DATA": {
      await insertMissingSqliteItems(message.items);
      const normalizedHandled = (await mutationContext()) !== null;
      if (!normalizedHandled) {
        throw new Error(
          "Normalized SQLite sample mutation context is required",
        );
      }
      for (const feed of message.feeds) {
        if (!(await maybeSubmitRssFeedUpsert(feed, timestamp))) {
          throw new Error(
            "Normalized SQLite RSS Feed mutation context changed",
          );
        }
      }
      if (!(await maybeSubmitPersonUpserts(message.persons, timestamp))) {
        throw new Error("Normalized SQLite Person mutation context changed");
      }
      if (!(await maybeSubmitAccountUpserts(message.accounts, timestamp))) {
        throw new Error("Normalized SQLite Account mutation context changed");
      }
      changedIds = message.items.map((item) => item.globalId);
      break;
    }
    case "CLEAR_SAMPLE_DATA": {
      const plan = await collectLibraryCoreSampleRemovalPlanV1(
        NORMALIZED_MUTATION_READER_RUNTIME,
      );
      const {
        feedUrls,
        itemIds: sampleItemIds,
        personIds: samplePersonIds,
        sampleAccountIds,
      } = plan;
      const normalizedHandled = (await mutationContext()) !== null;
      if (!normalizedHandled) {
        throw new Error(
          "Normalized SQLite sample mutation context is required",
        );
      }
      await commitDesktopLibrarySampleRemovalPlan(plan, timestamp);
      const summary = {
        feeds: feedUrls.length,
        items: sampleItemIds.length,
        persons: samplePersonIds.length,
        accounts: sampleAccountIds.length,
        total: 0,
      };
      summary.total =
        summary.feeds + summary.items + summary.persons + summary.accounts;
      result = summary;
      break;
    }
    case "UPDATE_FEED_ITEM": {
      const [item] = await readSqliteItems([message.globalId]);
      if (item) {
        const updated = deepMerge(item, message.updates);
        if (!(await maybeSubmitFeedItemCaptures([updated], timestamp))) {
          throw new Error(
            "Normalized SQLite FeedItem mutation context is required",
          );
        }
        if (
          (message.updates.userState?.tags !== undefined ||
            message.updates.userState?.highlights !== undefined) &&
          !(await maybeSubmitFeedItemAnnotationSets(
            [
              {
                entityId: message.globalId,
                highlights: updated.userState.highlights ?? [],
                tags: updated.userState.tags,
              },
            ],
            timestamp,
          ))
        ) {
          throw new Error(
            "Normalized SQLite FeedItem annotation mutation context is required",
          );
        }
        if (
          (message.updates.contentSignals !== undefined ||
            message.updates.eventCandidate !== undefined) &&
          !(await maybeSubmitFeedItemAnalysisSets(
            [
              {
                contentSignals: updated.contentSignals,
                entityId: message.globalId,
                eventCandidate: updated.eventCandidate,
              },
            ],
            timestamp,
          ))
        ) {
          throw new Error(
            "Normalized SQLite FeedItem analysis mutation context is required",
          );
        }
      }
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    }
    case "MARK_AS_READ":
      if (!(await maybeSubmitReadAssignments([message.globalId], timestamp))) {
        throw new Error("Normalized SQLite read mutation context is required");
      }
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "MARK_ITEMS_AS_READ":
      if (!(await maybeSubmitReadAssignments(message.globalIds, timestamp))) {
        throw new Error("Normalized SQLite read mutation context is required");
      }
      changedIds = [...message.globalIds];
      source = "item_patch";
      break;
    case "MARK_ALL_AS_READ": {
      if ((await mutationContext()) === null) {
        throw new Error("Normalized SQLite read mutation context is required");
      }
      const ids = await collectSqliteItemIds(
        { platform: message.platform },
        (item) => item.userState.readAt === undefined,
      );
      if (!(await maybeSubmitReadAssignments(ids, timestamp))) {
        throw new Error("Library mutation context changed during read commit");
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
        throw new Error("Normalized SQLite saved mutation context is required");
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
        throw new Error(
          "Normalized SQLite archive mutation context is required",
        );
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
        throw new Error(
          "Normalized SQLite archive mutation context is required",
        );
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
        throw new Error("Normalized SQLite liked mutation context is required");
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
        throw new Error(
          "Normalized SQLite FeedItem removal context is required",
        );
      }
      changedIds = [message.globalId];
      break;
    case "ARCHIVE_ALL_READ_UNSAVED": {
      if ((await mutationContext()) === null) {
        throw new Error(
          "Normalized SQLite archive mutation context is required",
        );
      }
      const ids = await collectSqliteItemIds(
        { platform: message.platform, feedUrl: message.feedUrl },
        (item) =>
          item.userState.readAt !== undefined &&
          !item.userState.saved &&
          !item.userState.archived &&
          !item.userState.hidden,
      );
      if (
        !(await maybeSubmitUserStateAssignments(
          ids.map((entityId) => ({
            entityId,
            field: "archived" as const,
            assigned: true,
            assignedAtMs: timestamp,
          })),
        ))
      ) {
        throw new Error(
          "Library mutation context changed during archive commit",
        );
      }
      break;
    }
    case "UNARCHIVE_SAVED_ITEMS": {
      if ((await mutationContext()) === null) {
        throw new Error(
          "Normalized SQLite archive mutation context is required",
        );
      }
      const ids = await collectSqliteItemIds(
        { saved: true, archived: true },
        () => true,
      );
      if (
        !(await maybeSubmitUserStateAssignments(
          ids.map((entityId) => ({
            entityId,
            field: "archived" as const,
            assigned: false,
            assignedAtMs: timestamp,
          })),
        ))
      ) {
        throw new Error(
          "Library mutation context changed during unarchive commit",
        );
      }
      break;
    }
    case "DELETE_ALL_ARCHIVED": {
      if ((await mutationContext()) === null) {
        throw new Error(
          "Normalized SQLite FeedItem removal context is required",
        );
      }
      const ids = await collectSqliteItemIds(
        { archived: true },
        (item) => !item.userState.saved,
      );
      if (!(await maybeSubmitFeedItemRemoves(ids, timestamp))) {
        throw new Error(
          "Library mutation context changed during removal commit",
        );
      }
      break;
    }
    case "PRUNE_ARCHIVED_ITEMS": {
      if ((await mutationContext()) === null) {
        throw new Error(
          "Normalized SQLite FeedItem removal context is required",
        );
      }
      const cutoff = timestamp - Math.max(0, message.maxAgeMs ?? 0);
      const ids = await collectSqliteItemIds(
        { archived: true },
        (item) =>
          !item.userState.saved &&
          item.userState.archivedAt !== undefined &&
          item.userState.archivedAt <= cutoff,
      );
      if (!(await maybeSubmitFeedItemRemoves(ids, timestamp))) {
        throw new Error(
          "Library mutation context changed during pruning commit",
        );
      }
      break;
    }
    case "ADD_RSS_FEED": {
      if (!(await maybeSubmitRssFeedUpsert(message.feed, timestamp))) {
        throw new Error(
          "Normalized SQLite RSS Feed mutation context is required",
        );
      }
      break;
    }
    case "UPDATE_RSS_FEED": {
      const feed = await readNormalizedRssFeed(message.url);
      if (!feed) break;
      // A rename must not resend stale polling settings or fetch history. Use
      // the same field assignment as PWA and the recovery name editor.
      const submitted =
        Object.keys(message.updates).length === 1 &&
        typeof message.updates.title === "string"
          ? await maybeSubmitRssFeedTitleAssignments(
              [{ url: message.url, title: message.updates.title }],
              timestamp,
            )
          : await maybeSubmitRssFeedUpsert(
              { ...feed, ...message.updates },
              timestamp,
            );
      if (!submitted) {
        throw new Error(
          "Normalized SQLite RSS Feed mutation context is required",
        );
      }
      break;
    }
    case "REMOVE_RSS_FEED": {
      if (
        !(await maybeSubmitRssFeedRemove({
          includeItems: message.includeItems === true,
          removedAtMs: timestamp,
          url: message.url,
        }))
      ) {
        throw new Error(
          "Normalized SQLite RSS Feed mutation context is required",
        );
      }
      break;
    }
    case "REMOVE_ALL_FEEDS": {
      const normalizedHandled = (await mutationContext()) !== null;
      if (!normalizedHandled) {
        throw new Error(
          "Normalized SQLite RSS Feed mutation context is required",
        );
      }
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
      break;
    }
    case "UPDATE_PREFERENCES": {
      if (!(await maybeSubmitPreferences(message.updates, timestamp))) {
        throw new Error(
          "Normalized SQLite preference mutation context is required",
        );
      }
      source = "preferences_patch";
      break;
    }
    case "BATCH_REFRESH_FEEDS": {
      await mergeIncomingSqliteItems(message.items);
      const feeds: RssFeed[] = [];
      for (const update of message.feeds) {
        const feed = await readNormalizedRssFeed(update.url);
        if (feed) feeds.push({ ...feed, ...update });
      }
      for (const feed of feeds) {
        if (!(await maybeSubmitRssFeedUpsert(feed, timestamp))) {
          throw new Error(
            "Normalized SQLite RSS Feed mutation context is required",
          );
        }
      }
      changedIds = message.items.map((item) => item.globalId);
      break;
    }
    case "HEAL_UNTITLED_FEEDS": {
      if ((await mutationContext()) === null) {
        throw new Error(
          "Normalized SQLite RSS Feed mutation context is required",
        );
      }
      await executeFrozenRssFeedScope(
        "rss_feeds_heal_untitled_frozen",
        timestamp,
        async (urls) => {
          const assignments = urls.flatMap((url) => {
            const title = repairedRssFeedTitle(url);
            return title ? [{ title, url }] : [];
          });
          if (
            !(await maybeSubmitRssFeedTitleAssignments(assignments, timestamp))
          ) {
            throw new Error(
              "Library mutation context changed during frozen RSS Feed repair",
            );
          }
        },
      );
      break;
    }
  }

  const { state, changedItems } =
    await refreshNormalizedMutationProjection(changedIds);
  const event: LibraryMutationEvent =
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

export async function createNormalizedLocalSnapshot(
  reason: "auto" | "manual",
): Promise<NormalizedLocalSnapshotSummary> {
  return invoke<NormalizedLocalSnapshotSummary>(
    "create_normalized_local_snapshot",
    {
      createdAtMs: Date.now(),
      reason,
    },
  );
}

export async function listNormalizedLocalSnapshots(): Promise<
  NormalizedLocalSnapshotSummary[]
> {
  return invoke<NormalizedLocalSnapshotSummary[]>(
    "list_normalized_local_snapshots",
  );
}

export async function restoreNormalizedLocalSnapshot(
  snapshotId: string,
  request: NormalizedLocalSnapshotRestoreRequest,
): Promise<NormalizedLocalSnapshotSummary> {
  const restored = await invoke<NormalizedLocalSnapshotSummary>(
    "restore_normalized_local_snapshot",
    {
      snapshotId,
      operationId: request.operationId,
      restoredAtMs: request.restoredAtMs,
    },
  );
  sqliteActive = true;
  return restored;
}

export async function clearNormalizedLocalSnapshots(): Promise<void> {
  await invoke("clear_normalized_local_snapshots");
}

export async function resetNormalizedLibrary(): Promise<void> {
  await invoke("reset_normalized_library");
  sqliteActive = false;
}

export function readNormalizedLibraryHandoffResultActors(handoffId: string, after: string | null): Promise<string[]> {
  if (!HEX_64.test(handoffId) || (after !== null && !HEX_64.test(after))) throw new TypeError("Invalid handoff result cursor");
  return invoke("read_normalized_library_handoff_result_actors", { handoffId, after });
}
