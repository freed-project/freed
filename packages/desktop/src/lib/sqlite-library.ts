/**
 * SQLite-only Freed Desktop Library runtime.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  buildDiscoveredAccountsFromItems,
  createDefaultPreferences,
  friendFromPerson,
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
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  finalizeLibraryCoreTransactionV1,
  LIBRARY_CORE_FACET_SUMMARY_QUERY_ID,
  LIBRARY_CORE_FACET_SUMMARY_SCHEMA_VERSION,
  PERSON_REMOVE_AND_ACCOUNTS_TRANSACTION_MEMBER_SCHEMA,
  PERSON_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  readLibraryCoreNormalizedItemDetailV1,
  sha256LowerHex,
  type AccountRemoveTransactionMemberInputV1,
  type AccountUpsertTransactionMemberInputV1,
  type FeedItemCaptureUpsertTransactionMemberInputV1,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type FeedItemRemoveTransactionMemberInputV1,
  type FeedItemUserStateAssignmentFieldV1,
  type FeedItemUserStateAssignmentTransactionMemberInputV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
  type PersonRemoveTransactionMemberInputV1,
  type PersonUpsertTransactionMemberInputV1,
  type PreferencesLeafAssignmentTransactionMemberInputV1,
  type RssFeedRemoveTransactionMemberInputV1,
  type RssFeedUpsertTransactionMemberInputV1,
} from "@freed/shared/library-core";
import { decodeJson, encodeJson } from "@freed/shared/projection";
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

export interface SqliteLibrarySyncDescriptor {
  revision: number;
  itemCount: number;
  sourceDigest: string;
  shellJson: string;
  materializedDigest: string;
}

export interface SqliteLibrarySyncPage {
  revision: number;
  itemsJson: string[];
  nextOffset: number | null;
}

export type SqliteLibraryAcceptedAuthority =
  LibraryCoreAcceptedAuthorityStateV1;

export interface SqliteLibraryAuthorityBootstrap {
  readonly authority: SqliteLibraryAcceptedAuthority;
  readonly actor: Readonly<{
    readonly actor_id: string;
    readonly actor_public_key: string;
    readonly enrollment_operation_id: string;
    readonly enrollment_certificate_digest: string;
    readonly canonical_enrollment_certificate_json: string;
    readonly actor_chain_genesis: string;
  }>;
  readonly protocol: SqliteLibraryAuthorityProtocol;
}

export interface SqliteLibraryAuthorityProtocol {
  readonly format: "freed_library_core_native_authority_protocol_v1";
  readonly active_engine: "library_core_v1";
  readonly schema_version: 12;
  readonly replication_protocol: "op_segments_v1";
  readonly checkpoint_format: "freed_logical_checkpoint_v1";
  readonly transition_certificate_digest: string;
  readonly native_protocol_certificate_digest: string;
  readonly prior_transition_certificate_digest: string | null;
  readonly source_manifest_digest: string;
}

export interface SqliteLibraryPersistedCloudIdentity {
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly writerId: string;
  readonly sourceDigest: string;
}

export interface SqliteLibraryWriterEpochReassignment extends SqliteLibraryAuthorityBootstrap {
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

export interface SqliteLibraryFollowerIntentContext {
  readonly authority: SqliteLibraryAcceptedAuthority;
  readonly actorId: string;
  readonly actorPublicKey: string;
  readonly nextIntentSequence: number;
  readonly previousOperationId: string | null;
  readonly previousChainDigest: string;
}

export interface SqliteLibraryFollowerRuntimeStatus {
  readonly state:
    | "awaiting_checkpoint"
    | "awaiting_enrollment"
    | "enrollment_pending"
    | "active";
  readonly libraryId: string | null;
  readonly epochId: string | null;
  readonly actorId: string | null;
  readonly checkpointGeneration: number | null;
  readonly remoteIngestSequence: number | null;
  readonly pendingIntentCount: number;
  readonly publishedIntentCount: number;
  readonly importedResultCount: number;
}

export interface SqliteLibraryFollowerCheckpointActor {
  readonly actor_id: string;
  readonly accepted_sequence: number;
  readonly accepted_operation_id: string | null;
  readonly accepted_chain_digest: string;
  readonly enrollment_certificate_digest: string;
}

export interface SqliteLibraryFollowerAnchorInput {
  readonly authority: SqliteLibraryAcceptedAuthority;
  readonly manifestObjectKey: string;
  readonly manifestTransportObjectId: string;
  readonly manifestContentDigest: string;
  readonly generation: number;
  readonly remoteIngestSequence: number;
  readonly remoteMaterializedDigest: string;
  readonly writerId: string;
  readonly controlRevision: string;
  readonly checkpointActor: SqliteLibraryFollowerCheckpointActor | null;
  readonly installedAtMs: number;
}

export interface SqliteLibraryFollowerOverlayReplayReceipt {
  readonly transactionCount: number;
  readonly operationCount: number;
  readonly materializedRowCount: number;
  readonly revisionAdvanced: boolean;
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

export interface SqliteLibraryFollowerIntentReceipt {
  readonly transactionId: string;
  readonly firstIntentSequence: number;
  readonly lastIntentSequence: number;
  readonly operationCount: number;
  readonly status: "enqueued" | "already_enqueued";
}

export interface SqliteLibraryFollowerActorRequest {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
  readonly actorPublicKey: string;
  readonly enrollmentRequestDigest: string;
  readonly canonicalEnrollmentRequestJson: string;
  readonly createdAtMs: number;
}

export interface SqliteLibraryFollowerActorEnrollment {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
  readonly actorPublicKey: string;
  readonly enrollmentCertificateDigest: string;
  readonly actorChainGenesis: string;
  readonly enrolledAtMs: number;
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

export async function prepareSqliteLibraryFollowerActorRequest(): Promise<SqliteLibraryFollowerActorRequest> {
  return invoke<SqliteLibraryFollowerActorRequest>(
    "prepare_sqlite_library_follower_actor_request",
    { request: { createdAtMs: Date.now() } },
  );
}

export async function installSqliteLibraryFollowerActorEnrollment(
  canonicalEnrollmentCertificateJson: string,
): Promise<SqliteLibraryFollowerActorEnrollment> {
  return invoke<SqliteLibraryFollowerActorEnrollment>(
    "install_sqlite_library_follower_actor_enrollment",
    { request: { canonicalEnrollmentCertificateJson } },
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

export async function sqliteLibraryFollowerIntentContext(): Promise<SqliteLibraryFollowerIntentContext | null> {
  return invoke<SqliteLibraryFollowerIntentContext | null>(
    "sqlite_library_follower_intent_context",
  );
}

export async function readSqliteLibraryFollowerRuntimeStatus(): Promise<SqliteLibraryFollowerRuntimeStatus> {
  return invoke<SqliteLibraryFollowerRuntimeStatus>(
    "sqlite_library_follower_runtime_status",
  );
}

export async function recoverSqliteLibraryFollowerOverlay(): Promise<SqliteLibraryFollowerOverlayReplayReceipt> {
  return invoke<SqliteLibraryFollowerOverlayReplayReceipt>(
    "recover_sqlite_library_follower_overlay",
  );
}

export async function signSqliteLibraryFollowerOperation(input: {
  readonly libraryId: string;
  readonly epochId: string;
  readonly actorId: string;
  readonly operationSigningBodyDigest: string;
}): Promise<SqliteLibraryFollowerOperationSignature> {
  return invoke<SqliteLibraryFollowerOperationSignature>(
    "sign_sqlite_library_follower_operation",
    { request: input },
  );
}

export async function enqueueSqliteLibraryFollowerIntent(
  canonicalEnvelopeJson: readonly string[],
): Promise<SqliteLibraryFollowerIntentReceipt> {
  if (
    canonicalEnvelopeJson.length === 0 ||
    canonicalEnvelopeJson.length > 1_000
  ) {
    throw new RangeError(
      "Follower intent transaction has an invalid member count",
    );
  }
  return invoke<SqliteLibraryFollowerIntentReceipt>(
    "enqueue_sqlite_library_follower_intent",
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
  let context: SqliteLibraryPrimaryMutationContext;
  try {
    context = await invoke<SqliteLibraryPrimaryMutationContext>(
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
  const follower = await sqliteLibraryFollowerIntentContext();
  if (!follower) return null;
  return {
    mode: "follower",
    libraryId: follower.authority.library_id,
    epoch: follower.authority.epoch,
    epochId: follower.authority.epoch_id,
    actorId: follower.actorId,
    actorPublicKey: follower.actorPublicKey,
    nextSequence: follower.nextIntentSequence,
    previousOperationId: follower.previousOperationId,
    previousChainDigest: follower.previousChainDigest,
    observedFrontier: follower.authority.observed_frontier,
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
          : await signSqliteLibraryFollowerOperation({
              libraryId: context.libraryId,
              epochId: context.epochId,
              actorId: context.actorId,
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
    await enqueueSqliteLibraryFollowerIntent(canonicalEnvelopeJson);
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
  const context = await mutationContext();
  if (!context) return false;
  const transactionId =
    `desktop-library-rss-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
  const schema = input.includeItems
    ? RSS_FEED_REMOVE_WITH_ITEMS_TRANSACTION_MEMBER_SCHEMA
    : RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA;
  const member = schema.construct(
    {
      operation_id: `${transactionId}:0`,
      library_id: context.libraryId,
      epoch: context.epoch,
      epoch_id: context.epochId,
      actor_id: context.actorId,
      actor_sequence: context.nextSequence,
      previous_actor_operation_id: context.previousOperationId,
      causal_frontier: context.observedFrontier,
      hlc_wall_ms: input.removedAtMs,
      hlc_counter: 0,
      transaction_id: transactionId,
      transaction_member_index: 0,
      transaction_member_count: 1,
      entity_id: input.url,
      payload: { removed_at_ms: input.removedAtMs },
      created_at_ms: input.removedAtMs,
    } satisfies RssFeedRemoveTransactionMemberInputV1,
    { digest: operationDigest },
  );
  await finalizeAndSubmitTransaction(context, [member], input.removedAtMs);
  return true;
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

export interface PortableSqliteLibraryImportRequest {
  expectedItemCount: number;
  shell: unknown;
  sourceCheckpoint?: Readonly<{
    objectKey: string;
    contentDigest: string;
    transportObjectId: string;
  }>;
  sourceDigest: string;
  sourceGeneration: number;
  sourceRevision: number;
}

interface SqliteShell {
  shellJson: string;
  revision: number;
  itemCount: number;
  unreadCount: number;
  archivableCount: number;
  countsByPlatform: Record<string, number>;
  unreadByPlatform: Record<string, number>;
}

interface SqliteCounts extends Omit<SqliteShell, "shellJson"> {
  archivableByPlatform: Record<string, number>;
  feedCounts: Record<string, number>;
  unreadFeedCounts: Record<string, number>;
  archivableFeedCounts: Record<string, number>;
}

interface SqliteQueryResult {
  itemsJson: string[];
  nextOffset: number | null;
  totalCount: number;
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

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

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

function shellFromState(state: DocState): Omit<DocState, "items" | "friends"> {
  const {
    items: _items,
    feedSourceOrderIds: _retiredSourceOrder,
    friends: _derivedFriends,
    ...shell
  } = state as DocState & { feedSourceOrderIds?: string[] };
  return shell;
}

function stateFromShell(result: SqliteShell, items: FeedItem[] = []): DocState {
  const {
    feedSourceOrderIds: _retiredSourceOrder,
    friends: _derivedFriends,
    ...decoded
  } = decodeJson(result.shellJson) as Partial<DocState> & {
    feedSourceOrderIds?: string[];
  };
  const base = { ...emptyShell(), ...decoded };
  const friends = Object.fromEntries(
    Object.values(base.persons).map((person) => [
      person.id,
      friendFromPerson(person, base.accounts),
    ]),
  );
  return {
    ...base,
    items,
    friends,
    searchCorpusVersion: result.revision,
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: result.unreadCount,
    unreadCountByPlatform: result.unreadByPlatform,
    totalItemCount: result.itemCount,
    itemCountByPlatform: result.countsByPlatform,
    totalArchivableCount: result.archivableCount,
    docItemCount: result.itemCount,
  };
}

export async function sqliteLibraryStatus(): Promise<SqliteStatus | null> {
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") return null;
  const status = await invoke<SqliteStatus | null>("sqlite_library_status");
  sqliteActive = status?.active === true;
  return status;
}

export async function readSqliteLibrarySyncDescriptor(): Promise<SqliteLibrarySyncDescriptor> {
  return invoke<SqliteLibrarySyncDescriptor>(
    "read_sqlite_library_sync_descriptor",
  );
}

/** Establish and read the active SQLite Library's signed authority and Desktop actor. */
const HEX_64 = /^[a-f0-9]{64}$/;

/** Close and validate the signed native protocol receipt returned by Rust. */
export function parseSqliteLibraryAuthorityProtocol(
  value: unknown,
): SqliteLibraryAuthorityProtocol {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Freed Desktop returned an invalid authority protocol");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "active_engine",
    "checkpoint_format",
    "format",
    "native_protocol_certificate_digest",
    "prior_transition_certificate_digest",
    "replication_protocol",
    "schema_version",
    "source_manifest_digest",
    "transition_certificate_digest",
  ].sort();
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    record.format !== "freed_library_core_native_authority_protocol_v1" ||
    record.active_engine !== "library_core_v1" ||
    record.schema_version !== 12 ||
    record.replication_protocol !== "op_segments_v1" ||
    record.checkpoint_format !== "freed_logical_checkpoint_v1" ||
    typeof record.transition_certificate_digest !== "string" ||
    !HEX_64.test(record.transition_certificate_digest) ||
    typeof record.native_protocol_certificate_digest !== "string" ||
    !HEX_64.test(record.native_protocol_certificate_digest) ||
    (record.prior_transition_certificate_digest !== null &&
      (typeof record.prior_transition_certificate_digest !== "string" ||
        !HEX_64.test(record.prior_transition_certificate_digest))) ||
    typeof record.source_manifest_digest !== "string" ||
    !HEX_64.test(record.source_manifest_digest)
  ) {
    throw new TypeError("Freed Desktop returned an invalid authority protocol");
  }
  return Object.freeze({
    format: record.format,
    active_engine: record.active_engine,
    schema_version: record.schema_version,
    replication_protocol: record.replication_protocol,
    checkpoint_format: record.checkpoint_format,
    transition_certificate_digest: record.transition_certificate_digest,
    native_protocol_certificate_digest:
      record.native_protocol_certificate_digest,
    prior_transition_certificate_digest:
      record.prior_transition_certificate_digest,
    source_manifest_digest: record.source_manifest_digest,
  });
}

export async function bootstrapSqliteLibraryAuthority(input: {
  readonly descriptor: SqliteLibrarySyncDescriptor;
  readonly persistedCloudIdentity: SqliteLibraryPersistedCloudIdentity | null;
}): Promise<SqliteLibraryAuthorityBootstrap> {
  const installationWitness = await invoke<string>(
    "get_desktop_installation_witness",
  );
  if (!HEX_64.test(installationWitness)) {
    throw new TypeError(
      "Freed Desktop returned an invalid installation witness",
    );
  }
  const bootstrap = await invoke<SqliteLibraryAuthorityBootstrap>(
    "bootstrap_sqlite_library_authority",
    {
      request: {
        installationWitness,
        acceptedAtMs: Date.now(),
        revision: input.descriptor.revision,
        itemCount: input.descriptor.itemCount,
        sourceDigest: input.descriptor.sourceDigest,
        materializedDigest: input.descriptor.materializedDigest,
        persistedCloudIdentity: input.persistedCloudIdentity,
      },
    },
  );
  return Object.freeze({
    ...bootstrap,
    protocol: parseSqliteLibraryAuthorityProtocol(bootstrap.protocol),
  });
}

/** Create or replay the signed native epoch used by one exact writer CAS. */
export async function reassignSqliteLibraryWriterEpoch(input: {
  readonly canonicalSourceControlJson: string;
  readonly libraryId: string;
  readonly targetWriterId: string;
}): Promise<SqliteLibraryWriterEpochReassignment> {
  const installationWitness = await invoke<string>(
    "get_desktop_installation_witness",
  );
  if (!/^[a-f0-9]{64}$/.test(installationWitness)) {
    throw new TypeError(
      "Freed Desktop returned an invalid installation witness",
    );
  }
  return invoke<SqliteLibraryWriterEpochReassignment>(
    "reassign_sqlite_library_writer_epoch",
    {
      request: {
        ...input,
        installationWitness,
        acceptedAtMs: Date.now(),
      },
    },
  );
}

/** Countersign and enroll one proof-only PWA actor request in native SQLite. */
export async function acceptPwaActorEnrollmentRequest(
  canonicalRequestBytes: Uint8Array,
): Promise<SqliteLibraryAuthorityBootstrap["actor"]> {
  if (
    canonicalRequestBytes.byteLength === 0 ||
    canonicalRequestBytes.byteLength > 65_536
  ) {
    throw new RangeError("PWA actor enrollment request has an invalid size");
  }
  return invoke<SqliteLibraryAuthorityBootstrap["actor"]>(
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

export async function readSqliteLibrarySyncPage(input: {
  revision: number;
  offset: number;
  limit?: number;
}): Promise<SqliteLibrarySyncPage> {
  return invoke<SqliteLibrarySyncPage>("read_sqlite_library_sync_page", {
    request: {
      revision: input.revision,
      offset: input.offset,
      limit: input.limit ?? 128,
    },
  });
}

export async function beginPortableSqliteLibraryImport(
  request: PortableSqliteLibraryImportRequest,
): Promise<void> {
  await invoke("begin_sqlite_library_import", {
    request: {
      expectedItemCount: request.expectedItemCount,
      shellJson: encodeJson(request.shell),
      sourceDigest: request.sourceDigest,
      sourceCheckpointObjectKey: request.sourceCheckpoint?.objectKey,
      sourceCheckpointContentDigest: request.sourceCheckpoint?.contentDigest,
      sourceCheckpointTransportObjectId:
        request.sourceCheckpoint?.transportObjectId,
      sourceGeneration: request.sourceGeneration,
      sourceRevision: request.sourceRevision,
      startedAtMs: Date.now(),
    },
  });
  // Native imports stage beside the active Library. Preserve its runtime
  // admission fences until finalize atomically swaps the staged checkpoint.
  // A first import still reports inactive here and becomes active at finalize.
  await sqliteLibraryStatus();
}

export async function appendPortableSqliteLibraryItems(
  items: readonly unknown[],
): Promise<void> {
  if (items.length === 0) return;
  for (let start = 0; start < items.length; start += 1_000) {
    await invoke("append_sqlite_library_import", {
      request: {
        itemsBase64: items
          .slice(start, start + 1_000)
          .map((item) => encodeUtf8Base64(encodeJson(item))),
        updatedAtMs: Date.now(),
      },
    });
  }
}

export async function finalizePortableSqliteLibraryImport(
  followerAnchor?: SqliteLibraryFollowerAnchorInput,
): Promise<SqliteStatus> {
  const status = await invoke<SqliteStatus>("finalize_sqlite_library_import", {
    activatedAtMs: Date.now(),
    followerAnchor,
  });
  sqliteActive = status.active;
  return status;
}

export async function loadSqliteLibraryState(): Promise<DocState> {
  const result = await invoke<SqliteShell>("read_sqlite_library_shell");
  sqliteActive = true;
  // Browser E2E tests deliberately keep the legacy renderer projection so
  // their UI assertions can exercise cards, maps, and mutations without a
  // native process. Production Freed Desktop never takes this branch and
  // continues to hold only bounded SQLite pages in renderer memory.
  if (import.meta.env.VITE_TEST_TAURI === "1") {
    const items: FeedItem[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await querySqliteItems({
        offset,
        limit: 128,
        showHidden: true,
      });
      items.push(...page.items);
      offset = page.nextOffset;
    }
    return stateFromShell(result, items);
  }
  return stateFromShell(result);
}

async function replaceShell(state: DocState): Promise<void> {
  await invoke("replace_sqlite_library_shell", {
    request: { shellJson: encodeJson(shellFromState(state)) },
  });
}

async function upsertSqliteItems(items: readonly FeedItem[]): Promise<void> {
  if (items.length === 0) return;
  for (let start = 0; start < items.length; start += 1_000) {
    await invoke("upsert_sqlite_library_items", {
      request: {
        itemsBase64: items
          .slice(start, start + 1_000)
          .map((item) => encodeUtf8Base64(encodeJson(item))),
        updatedAtMs: Date.now(),
      },
    });
  }
}

export async function readSqliteItems(
  ids: readonly string[],
): Promise<FeedItem[]> {
  if (ids.length === 0) return [];
  const encoded = await invoke<string[]>("read_sqlite_library_items", {
    request: { ids: [...ids] },
  });
  return encoded.map((item) => decodeJson(item) as FeedItem);
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

export async function querySqliteItems(
  options: {
    query?: string;
    platform?: string;
    authorId?: string;
    feedUrl?: string;
    contentType?: string;
    excludeContentType?: string;
    tags?: readonly string[];
    signals?: readonly string[];
    authorKeys?: readonly Readonly<{ platform: string; authorId: string }>[];
    hasLinkPreview?: boolean;
    missingPreservedText?: boolean;
    hasMedia?: boolean;
    locationCandidate?: boolean;
    includeTotalCount?: boolean;
    saved?: boolean;
    archived?: boolean;
    showHidden?: boolean;
    sortMode?:
      "date_saved" | "date_published" | "recommended" | "shortest_read";
    offset?: number;
    limit?: number;
  } = {},
): Promise<{
  items: FeedItem[];
  nextOffset: number | null;
  totalCount: number;
}> {
  const result = await invoke<SqliteQueryResult>("query_sqlite_library_items", {
    request: {
      query: options.query ?? null,
      platform: options.platform ?? null,
      authorId: options.authorId ?? null,
      feedUrl: options.feedUrl ?? null,
      contentType: options.contentType ?? null,
      excludeContentType: options.excludeContentType ?? null,
      tags: options.tags?.length ? [...options.tags] : null,
      signals: options.signals?.length ? [...options.signals] : null,
      authorKeys: options.authorKeys?.length ? [...options.authorKeys] : null,
      hasLinkPreview: options.hasLinkPreview ?? null,
      missingPreservedText: options.missingPreservedText ?? null,
      hasMedia: options.hasMedia ?? null,
      locationCandidate: options.locationCandidate ?? null,
      includeTotalCount: options.includeTotalCount ?? true,
      saved: options.saved ?? null,
      archived: options.archived ?? null,
      showHidden: options.showHidden ?? false,
      sortMode: options.sortMode ?? null,
      offset: options.offset ?? 0,
      limit: options.limit ?? 64,
    },
  });
  return {
    items: result.itemsJson.map((item) => decodeJson(item) as FeedItem),
    nextOffset: result.nextOffset,
    totalCount: result.totalCount,
  };
}

async function collectSqliteItemIds(
  options: Parameters<typeof querySqliteItems>[0],
  include: (item: FeedItem) => boolean,
): Promise<string[]> {
  const ids: string[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await querySqliteItems({
      ...options,
      includeTotalCount: false,
      limit: 1_000,
      offset,
      showHidden: true,
    });
    for (const item of page.items) {
      if (include(item)) ids.push(item.globalId);
    }
    offset = page.nextOffset;
  }
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
  const ids = options.ids ?? [];
  const timestampMs = options.timestampMs ?? Date.now();
  const invokeBatch = (batch: readonly string[]) =>
    invoke<number>("mutate_sqlite_library_items", {
      request: {
        mutation,
        ids: [...batch],
        platform: options.platform ?? null,
        feedUrl: options.feedUrl ?? null,
        timestampMs,
        maxAgeMs: options.maxAgeMs ?? null,
      },
    });
  if (ids.length === 0) return invokeBatch([]);
  let affected = 0;
  for (let start = 0; start < ids.length; start += 1_000) {
    affected += await invokeBatch(ids.slice(start, start + 1_000));
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
  const result = await invoke<SqliteCounts>("read_sqlite_library_counts");
  return {
    ...state,
    searchCorpusVersion: result.revision,
    feedUnreadCounts: result.unreadFeedCounts,
    feedTotalCounts: result.feedCounts,
    totalUnreadCount: result.unreadCount,
    unreadCountByPlatform: result.unreadByPlatform,
    totalItemCount: result.itemCount,
    itemCountByPlatform: result.countsByPlatform,
    totalArchivableCount: result.archivableCount,
    archivableCountByPlatform: result.archivableByPlatform,
    archivableFeedCounts: result.archivableFeedCounts,
    docItemCount: result.itemCount,
  };
}

const NORMALIZED_MUTATION_READER_RUNTIME = Object.freeze({
  query: queryNormalizedLibrary,
  randomId: () => crypto.randomUUID(),
});

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
  await replaceShell(next);
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
        const existing = nextState.accounts[account.id];
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
      await mutateItems("confirm_liked", {
        ids: [message.globalId],
        timestampMs: message.syncedAt ?? timestamp,
      });
      changedIds = [message.globalId];
      source = "item_patch";
      break;
    case "CONFIRM_SEEN_SYNCED":
      await mutateItems("confirm_seen", {
        ids: [message.globalId],
        timestampMs: message.syncedAt ?? timestamp,
      });
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
      const feed = nextState.feeds[message.url];
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
        for (const feed of Object.values(nextState.feeds)) {
          await maybeSubmitRssFeedRemove({
            includeItems: message.includeItems === true,
            removedAtMs: timestamp,
            url: feed.url,
          });
        }
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
      const person = nextState.persons[message.personId];
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
          const account = nextState.accounts[accountId];
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
      const person = nextState.persons[message.personId];
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
      const account = nextState.accounts[message.accountId];
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
      const feeds = message.feeds.flatMap((update) => {
        const feed = nextState.feeds[update.url];
        return feed ? [{ ...feed, ...update }] : [];
      });
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
      const feeds: RssFeed[] = [];
      for (const feed of Object.values(nextState.feeds)) {
        if (feed.title !== "Untitled Feed" && feed.title !== feed.url) continue;
        try {
          const title = new URL(feed.url).hostname.replace(
            /^(?:www|feeds?)\./,
            "",
          );
          if (title && title !== feed.title) feeds.push({ ...feed, title });
        } catch {
          // A malformed legacy feed URL remains unchanged.
        }
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
    // Browser E2E deliberately retains the complete mock projection so existing
    // workflow tests can inspect injected rows. Production never reloads it.
    state = await refreshSqliteLibraryCounts(
      import.meta.env.VITE_TEST_TAURI === "1"
        ? await loadSqliteLibraryState()
        : nextState,
    );
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
