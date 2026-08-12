import {
  assembleLibraryCoreTransactionV1,
  decodeLibraryCoreFeedPageCursorV1,
  constructLibraryCoreActorEnrollmentBodyV1,
  constructLibraryCoreActorEnrollmentRequestV1,
  encodeLibraryCoreFeedPageCursorV1,
  LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS,
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  FEED_ITEM_READ_AT_FIELD_ALGEBRA,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  finalizeLibraryCoreTransactionV1,
  intentSegmentBodyFromRecordsV1,
  isLibraryCoreFinalizedTransactionV1,
  isLibraryCoreVisibleFeedItemV1,
  LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT,
  LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT,
  parseLibraryCoreCheckpointManifestV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreIntentHeadV1,
  parseLibraryCoreIntentSegmentBodyV1,
  parseLibraryCoreIntentSegmentEntryV1,
  parseLibraryCoreIntentSegmentHeaderV1,
  parseLibraryCoreIntentResultEntryV1,
  parseLibraryCoreOperationSegmentEntryV1,
  parseLibraryCoreOperationSegmentHeaderV1,
  parseLibraryCorePortableCheckpointRecordV1,
  parseLibraryCoreResultSegmentHeaderV1,
  projectLibraryCoreFeedCardV1,
  isLibraryCoreLowercaseHex64,
  sha256LowerHex,
  verifyLibraryCoreActorEnrollmentCertificateV1,
  verifyLibraryCoreEd25519WithWebCrypto,
  verifyLibraryCoreOperationTransactionV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreAcceptedActorStateV1,
  type LibraryCoreAcceptedAuthorityStateV1,
  type LibraryCoreActorEnrollmentRequestV1,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreCheckpointManifestV1,
  type LibraryCoreEd25519PublicKeyHex,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageCursorV1,
  type LibraryCoreFeedPageRequestV1,
  type LibraryCoreFeedPageResponseV1,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreFinalizedTransactionV1,
  type FeedItemReadAssignmentTransactionMemberInputV1,
  type FeedItemRemoveTransactionMemberInputV1,
  type FeedItemUserStateAssignmentFieldV1,
  type FeedItemUserStateAssignmentTransactionMemberInputV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreIntentHeadV1,
  type LibraryCoreIntentSegmentBodyV1,
  type LibraryCoreIntentSegmentEntryV1,
  type LibraryCoreIntentSegmentHeaderV1,
  type LibraryCoreIntentResultEntryV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
  type LibraryCoreOperationSegmentEntryV1,
  type LibraryCoreOperationSegmentHeaderV1,
  type LibraryCorePortableCheckpointCollection,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
  type LibraryCoreResultSegmentHeaderV1,
} from "@freed/shared/library-core";
import type { FeedItem } from "@freed/shared";
import type {
  LibraryCoreOperationSegmentImportReceiptV1,
  LibraryCoreOperationSegmentImportWriterV1,
  LibraryCorePortableCheckpointImportWriterV1,
  LibraryCorePortableCheckpointStagingReceiptV1,
  LibraryCorePreparedImmutableObjectV1,
} from "@freed/sync/cloud";

import {
  lowerHex,
  requestResult,
  transactionDone,
} from "./library-core-indexeddb";

const DATABASE_VERSION = 8;
const GENERATIONS_STORE = "portable_generations";
const RECORDS_STORE = "portable_records";
const PAGES_STORE = "portable_pages";
const CONTROL_STORE = "portable_control";
const OPERATIONS_STORE = "portable_operations";
const SEGMENTS_STORE = "portable_segments";
const ACTOR_ENROLLMENTS_STORE = "portable_actor_enrollments";
const ACTOR_TIPS_STORE = "portable_actor_tips";
const AUTHENTICATED_OPERATIONS_STORE = "portable_authenticated_operations";
const AUTHENTICATED_SEGMENTS_STORE = "portable_authenticated_segments";
const MATERIALIZED_ROWS_STORE = "portable_materialized_rows";
const READ_STATE_STORE = "portable_read_state";
const FEED_ROWS_STORE = "portable_feed_rows";
const INTENT_ACTORS_STORE = "portable_intent_actors";
const INTENT_OPERATIONS_STORE = "portable_intent_operations";
const INTENT_TRANSACTIONS_STORE = "portable_intent_transactions";
const INTENT_PUBLICATIONS_STORE = "portable_intent_publications";
const INTENT_RESULTS_STORE = "portable_intent_results";
const RESULT_ACTORS_STORE = "portable_result_actors";
const PWA_ACTOR_IDENTITIES_STORE = "portable_pwa_actor_identities";
const PWA_ACTOR_ENROLLMENT_REQUESTS_STORE =
  "portable_pwa_actor_enrollment_requests";
const SELECTED_GENERATION_KEY = "selected_portable_generation";
const MAXIMUM_RETAINED_GENERATIONS = 2;
const MAXIMUM_COLLECTION_PAGE_ROWS = 128;
const FEED_PROJECTION_REVISION = 1;
const FEED_SESSION_MAXIMUM_AGE_MS = 60_000;
const MAXIMUM_FEED_READER_SESSIONS = 2;
const MAXIMUM_SAFE_SORT_KEY = Number.MAX_SAFE_INTEGER;
const TEXT_ENCODER = new TextEncoder();

type GenerationStatus = "complete" | "staging";

interface PortableGenerationRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly status: GenerationStatus;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly storageEpoch: LibraryCoreOperationInstanceId;
  readonly manifestGeneration: number;
  readonly manifestObjectKey: string;
  readonly manifestPageCount: number;
  readonly manifestStoredByteLength: number;
  readonly totalRecordCount: number;
  readonly frontierDigest: LibraryCoreLowercaseHex64;
  readonly checkpointFrontierDigest: LibraryCoreLowercaseHex64;
  readonly importedThroughIngestSequence: number;
  readonly latestOperationSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly authenticatedThroughIngestSequence: number;
  readonly authenticatedFrontierDigest: LibraryCoreLowercaseHex64;
  readonly latestAuthenticatedSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly visibleFeedRowCount: number;
  readonly manifestTransportObjectId: string;
  readonly writtenRecordCount: number;
  readonly nextPageIndex: number;
  readonly header: LibraryCorePortableCheckpointHeaderV1 | null;
  readonly headerDigest: LibraryCoreLowercaseHex64 | null;
  readonly selectionSequence: number | null;
}

interface PortablePageRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly pageIndex: number;
  readonly pageDigest: LibraryCoreLowercaseHex64;
  readonly recordCount: number;
  readonly writtenRecordCountAfter: number;
}

interface PortableEntryRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly collection: LibraryCorePortableCheckpointCollection;
  readonly ordinal: number;
  readonly entry: LibraryCorePortableCheckpointEntryV1;
}

interface PortableMaterializedRowRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly primaryKey: string;
  readonly registryKey: string;
  readonly row: Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

interface PortableActorTipRecord {
  readonly acceptedChainDigest: LibraryCoreLowercaseHex64;
  readonly acceptedOperationId: LibraryCoreOperationInstanceId | null;
  readonly acceptedSequence: number;
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly enrollmentCertificateDigest: LibraryCoreLowercaseHex64;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly retired: boolean;
}

interface PortableActorEnrollmentRecord {
  readonly actorChainGenesis: LibraryCoreLowercaseHex64;
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorPublicKey: LibraryCoreEd25519PublicKeyHex;
  readonly certificateDigest: LibraryCoreLowercaseHex64;
  readonly generationId: LibraryCoreLowercaseHex64;
}

interface PortableReadStateRecord {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorSequence: number;
  readonly chainDigest: LibraryCoreLowercaseHex64;
  readonly entityId: string;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly operationId: string;
  readonly readAtMs: number;
}

interface PortableFeedRowRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly globalId: string;
  readonly orderKey: string;
  readonly row: LibraryCoreFeedCardV1;
  readonly sortAt: number;
}

interface PortableFeedReaderSession {
  readonly expiresAtMs: number;
  readonly source: LibraryCoreFeedPageSourceV1;
  lastRequest: Readonly<{
    cancellationId: string;
    cursor: string | null;
    limit: number;
  }> | null;
}

type PortableFeedSessionAdmission =
  | Readonly<{
      ok: true;
      cursor: LibraryCoreFeedPageCursorV1 | null;
    }>
  | Readonly<{
      ok: false;
      result: PwaLibraryCorePortableFeedReaderResult;
    }>;

interface SelectedPortableGenerationRecord {
  readonly key: typeof SELECTED_GENERATION_KEY;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly selectionSequence: number;
}

interface PortableOperationRecord {
  readonly entry: LibraryCoreOperationSegmentEntryV1;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly ingestSequence: number;
  readonly operationId: string;
  readonly segmentDigest: LibraryCoreLowercaseHex64;
}

interface PortableSegmentRecord {
  readonly firstIngestSequence: number;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly header: LibraryCoreOperationSegmentHeaderV1;
  readonly lastIngestSequence: number;
  readonly objectKey: string;
  readonly storedByteLength: number;
  readonly storedContentDigest: LibraryCoreLowercaseHex64;
  readonly transportObjectId: string;
}

interface PortableAuthenticatedOperationRecord extends PortableOperationRecord {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorSequence: number;
  readonly actorChainDigest: LibraryCoreLowercaseHex64;
  readonly transactionDigest: LibraryCoreLowercaseHex64;
}

interface PortableAuthenticatedSegmentRecord extends PortableSegmentRecord {
  readonly transactionDigests: readonly LibraryCoreLowercaseHex64[];
}

interface PortableIntentActorRecord {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly latestActorChainDigest: LibraryCoreLowercaseHex64;
  readonly latestOperationId: LibraryCoreOperationInstanceId;
  readonly latestPublishedSegment: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly latestPublishedStoredDigest: LibraryCoreLowercaseHex64 | null;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly nextIntentSequence: number;
  readonly publishedThroughIntentSequence: number;
  readonly schemaVersion: number;
}

interface PortableIntentOperationRecord {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly entry: LibraryCoreIntentSegmentEntryV1;
  readonly envelopeDigest: LibraryCoreLowercaseHex64;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly intentSequence: number;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly publishedStoredDigest: LibraryCoreLowercaseHex64 | null;
  readonly transactionDigest: LibraryCoreLowercaseHex64;
  readonly transactionId: LibraryCoreOperationInstanceId;
}

interface PortableIntentTransactionRecord {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly canonicalEnvelopeBytes: number;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly firstIntentSequence: number;
  readonly lastIntentSequence: number;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly operationCount: number;
  readonly operationIds: readonly LibraryCoreOperationInstanceId[];
  readonly transactionDigest: LibraryCoreLowercaseHex64;
  readonly transactionId: LibraryCoreOperationInstanceId;
}

interface PortableIntentPublicationRecord {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly bodyDigest: LibraryCoreLowercaseHex64;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly expectedHeadDigest: LibraryCoreLowercaseHex64;
  readonly firstIntentSequence: number;
  readonly headDigest: LibraryCoreLowercaseHex64;
  readonly lastIntentSequence: number;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly segmentReference: LibraryCoreImmutableObjectReferenceV1;
  readonly storedContentDigest: LibraryCoreLowercaseHex64;
}

interface PortableResultActorRecord {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly latestSegment: LibraryCoreImmutableObjectReferenceV1;
  readonly latestSegmentDigest: LibraryCoreLowercaseHex64;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly nextResultSequence: number;
}

interface PortableIntentResultRecord {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly entry: LibraryCoreIntentResultEntryV1;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly resultSequence: number;
  readonly segmentDigest: LibraryCoreLowercaseHex64;
  readonly segmentReference: LibraryCoreImmutableObjectReferenceV1;
}

interface PortablePwaActorIdentityRecord {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorIncarnationNonce: LibraryCoreLowercaseHex64;
  readonly actorPrivateKey: CryptoKey;
  readonly actorPublicKey: LibraryCoreEd25519PublicKeyHex;
  readonly installationIncarnation: LibraryCoreLowercaseHex64;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly schemaVersion: 1;
}

interface PortablePwaActorEnrollmentRequestRecord {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly authorityStateDigest: LibraryCoreLowercaseHex64;
  readonly canonicalBytes: Uint8Array;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly publishedReference: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly request: LibraryCoreActorEnrollmentRequestV1;
  readonly schemaVersion: 1;
}

export interface PwaLibraryCorePortableCheckpointStoreOptions {
  readonly databaseName: string;
  readonly indexedDb: IDBFactory;
  readonly keyRange: typeof IDBKeyRange;
  readonly subtle: SubtleCrypto;
  readonly now?: () => number;
  readonly randomBytes?: (byteLength: number) => Uint8Array;
}

export interface PwaLibraryCoreActorEnrollmentRequestCandidateV1 {
  readonly acceptedAuthorityState: LibraryCoreAcceptedAuthorityStateV1;
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly authorityStateDigest: LibraryCoreLowercaseHex64;
  readonly immutableObject: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
  readonly publishedReference: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly request: LibraryCoreActorEnrollmentRequestV1;
}

export interface PwaLibraryCoreIntentEnqueueReceiptV1 {
  readonly firstIntentSequence: number;
  readonly lastIntentSequence: number;
  readonly operationCount: number;
  readonly status: "already_enqueued" | "enqueued";
  readonly transactionId: LibraryCoreOperationInstanceId;
}

export interface ReadPwaLibraryCoreIntentCandidateInput {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly libraryId: LibraryCoreOperationInstanceId;
  readonly maximumCanonicalEnvelopeBytes?: number;
  readonly maximumOperations?: number;
}

export interface PwaLibraryCoreIntentSegmentCandidateV1 {
  readonly body: LibraryCoreIntentSegmentBodyV1;
  readonly expectedHead: LibraryCoreIntentHeadV1;
  readonly expectedHeadDigest: LibraryCoreLowercaseHex64;
  readonly transactionCount: number;
}

export interface PwaLibraryCorePendingIntentActorV1 {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly epochId: LibraryCoreOperationInstanceId;
  readonly libraryId: LibraryCoreOperationInstanceId;
}

export interface RecordPwaLibraryCoreIntentPublicationInput {
  readonly entries: readonly LibraryCoreIntentSegmentEntryV1[];
  readonly expectedHeadDigest: LibraryCoreLowercaseHex64;
  readonly header: LibraryCoreIntentSegmentHeaderV1;
  readonly publishedHead: LibraryCoreIntentHeadV1;
  readonly readBackHeadDigest: LibraryCoreLowercaseHex64;
  readonly segmentReference: LibraryCoreImmutableObjectReferenceV1;
}

export interface PwaLibraryCoreIntentPublicationReceiptV1 {
  readonly firstIntentSequence: number;
  readonly headDigest: LibraryCoreLowercaseHex64;
  readonly lastIntentSequence: number;
  readonly operationCount: number;
  readonly status: "already_recorded" | "recorded";
  readonly storedContentDigest: LibraryCoreLowercaseHex64;
}

export interface PwaLibraryCoreIntentResultV1 {
  readonly intentOperationId: LibraryCoreOperationInstanceId;
  readonly providerReceiptDigest: LibraryCoreLowercaseHex64 | null;
  readonly resultOperationId: LibraryCoreOperationInstanceId;
  readonly resultSequence: number;
  readonly status: "accepted" | "provider_completed" | "provider_failed";
}

export interface ReadPwaLibraryCorePortableCollectionPageInput {
  readonly afterOrdinal: number | null;
  readonly collection: LibraryCorePortableCheckpointCollection;
  readonly limit: number;
}

export interface PwaLibraryCorePortableCollectionPage {
  readonly entries: readonly LibraryCorePortableCheckpointEntryV1[];
  readonly frontierDigest: LibraryCoreLowercaseHex64;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly materializedDigest: LibraryCoreLowercaseHex64;
  readonly nextOrdinal: number | null;
}

export interface ReadPwaLibraryCoreOperationPageInput {
  readonly afterIngestSequence: number;
  readonly limit: number;
}

export interface PwaLibraryCoreOperationPage {
  readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
  readonly frontierDigest: LibraryCoreLowercaseHex64;
  readonly importedThroughIngestSequence: number;
  readonly latestOperationSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly nextAfterIngestSequence: number | null;
}

export interface PwaLibraryCoreAuthenticatedOperationPage extends PwaLibraryCoreOperationPage {
  readonly authenticatedThroughIngestSequence: number;
}

export interface PwaLibraryCoreReadState {
  readonly entityId: string;
  readonly readAtMs: number;
  readonly sourceOperationId: string;
}

export type PwaLibraryCorePortableFeedReaderErrorCode =
  | "RUNTIME_INACTIVE"
  | "CURSOR_STALE"
  | "SESSION_LIMIT"
  | "INVALID_REQUEST"
  | "RESPONSE_TOO_LARGE"
  | "READER_UNAVAILABLE";

export type PwaLibraryCorePortableFeedReaderResult =
  | Readonly<{
      ok: true;
      value: LibraryCoreFeedPageResponseV1;
    }>
  | Readonly<{
      ok: false;
      code: PwaLibraryCorePortableFeedReaderErrorCode;
      message: string;
    }>;

function snapshotReference(
  reference: LibraryCoreImmutableObjectReferenceV1,
): LibraryCoreImmutableObjectReferenceV1 {
  return Object.freeze({
    descriptor: Object.freeze({
      byteLength: reference.descriptor.byteLength,
      contentDigest: reference.descriptor.contentDigest,
      objectKey: reference.descriptor.objectKey,
    }),
    transportObjectId: reference.transportObjectId,
  });
}

function generationMatches(
  generation: PortableGenerationRecord,
  manifest: LibraryCoreCheckpointManifestV1,
  reference: LibraryCoreImmutableObjectReferenceV1,
): boolean {
  return (
    generation.generationId === reference.descriptor.contentDigest &&
    generation.libraryId === manifest.libraryId &&
    generation.storageEpoch === manifest.storageEpoch &&
    generation.manifestGeneration === manifest.generation &&
    generation.manifestObjectKey === reference.descriptor.objectKey &&
    generation.manifestPageCount === manifest.pages.length &&
    generation.manifestStoredByteLength === reference.descriptor.byteLength &&
    generation.manifestTransportObjectId === reference.transportObjectId &&
    generation.totalRecordCount === manifest.totalRecordCount &&
    generation.checkpointFrontierDigest === manifest.causalFrontierDigest
  );
}

function assertManifestReference(
  manifest: LibraryCoreCheckpointManifestV1,
  reference: LibraryCoreImmutableObjectReferenceV1,
): void {
  const expectedKey = createLibraryCoreImmutableObjectKey({
    kind: "checkpoint_manifest",
    libraryId: manifest.libraryId,
    epochId: manifest.storageEpoch,
    generation: manifest.generation,
    digest: reference.descriptor.contentDigest,
  });
  if (reference.descriptor.objectKey !== expectedKey) {
    throw new TypeError(
      "portable checkpoint manifest reference does not match its library, epoch, and generation",
    );
  }
}

function entriesRange(
  keyRange: typeof IDBKeyRange,
  generationId: string,
): IDBKeyRange {
  return keyRange.bound(
    [generationId, "", 0],
    [generationId, "\uffff", Number.MAX_SAFE_INTEGER],
  );
}

function collectionRange(
  keyRange: typeof IDBKeyRange,
  generationId: string,
  collection: LibraryCorePortableCheckpointCollection,
  afterOrdinal = -1,
): IDBKeyRange {
  return keyRange.bound(
    [generationId, collection, afterOrdinal + 1],
    [generationId, collection, Number.MAX_SAFE_INTEGER],
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function libraryCoreDigest(
  domain: Parameters<typeof encodeLibraryCoreDigestInput>[0],
  value: unknown,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
  );
}

function canonicalStringKey(value: LibraryCoreCanonicalValue): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    encodeLibraryCoreCanonicalValue(value),
  );
}

function reverseFeedSortKey(sortAt: number): string {
  return (MAXIMUM_SAFE_SORT_KEY - sortAt).toString(16).padStart(14, "0");
}

function portableFeedRowOrderKey(row: LibraryCoreFeedCardV1): string {
  return `${reverseFeedSortKey(row.publishedAt ?? 0)}\u0000${lowerHex(
    TEXT_ENCODER.encode(row.globalId).buffer,
  )}`;
}

const PORTABLE_FEED_REGISTRY_KEYS = Object.freeze([
  "10_feed_items",
  "feedItems",
] as const);

function isPortableFeedRegistryKey(registryKey: string): boolean {
  return PORTABLE_FEED_REGISTRY_KEYS.some(
    (candidate) => candidate === registryKey,
  );
}

function projectPortableFeedRow(
  generationId: LibraryCoreLowercaseHex64,
  materialized: PortableMaterializedRowRecord,
): PortableFeedRowRecord | null {
  if (!isPortableFeedRegistryKey(materialized.registryKey)) return null;
  const globalId = materialized.row.globalId;
  if (
    typeof globalId !== "string" ||
    canonicalStringKey(globalId) !== materialized.primaryKey
  ) {
    throw new TypeError(
      "portable feed item identity does not match its materialized primary key",
    );
  }
  const item = materialized.row as unknown as FeedItem;
  if (!isLibraryCoreVisibleFeedItemV1(item)) return null;
  const row = projectLibraryCoreFeedCardV1(item);
  return Object.freeze({
    generationId,
    globalId: row.globalId,
    orderKey: portableFeedRowOrderKey(row),
    row,
    sortAt: row.publishedAt ?? 0,
  });
}

function assignedPortableFeedRow(
  stored: PortableMaterializedRowRecord,
  field: FeedItemUserStateAssignmentFieldV1,
  assigned: boolean,
  assignedAtMs: number,
): PortableMaterializedRowRecord {
  const current =
    typeof stored.row.userState === "object" &&
    stored.row.userState !== null &&
    !Array.isArray(stored.row.userState)
      ? (stored.row.userState as Readonly<
          Record<string, LibraryCoreCanonicalValue>
        >)
      : {};
  const next: Record<string, LibraryCoreCanonicalValue> = { ...current };
  if (field === "saved") {
    next.saved = assigned;
    if (assigned) {
      next.savedAt = assignedAtMs;
      next.archived = false;
      delete next.archivedAt;
    } else {
      delete next.savedAt;
    }
  } else if (field === "archived") {
    if (assigned && current.saved === true) return stored;
    next.archived = assigned;
    if (assigned) next.archivedAt = assignedAtMs;
    else delete next.archivedAt;
  } else {
    next.liked = assigned;
    if (assigned) next.likedAt = assignedAtMs;
    else delete next.likedAt;
    delete next.likedSyncedAt;
  }
  return {
    ...stored,
    row: { ...stored.row, userState: next },
  } satisfies PortableMaterializedRowRecord;
}

function portableFeedSource(
  generation: PortableGenerationRecord,
): LibraryCoreFeedPageSourceV1 {
  return Object.freeze({
    generationId: generation.generationId,
    projectionRevision: FEED_PROJECTION_REVISION,
    transitionSequence: generation.authenticatedThroughIngestSequence,
  });
}

function portableFeedSourceMatches(
  left: LibraryCoreFeedPageSourceV1,
  right: LibraryCoreFeedPageSourceV1,
): boolean {
  return (
    left.generationId === right.generationId &&
    left.projectionRevision === right.projectionRevision &&
    left.transitionSequence === right.transitionSequence
  );
}

function portableFeedReaderFailure(
  code: PwaLibraryCorePortableFeedReaderErrorCode,
  message: string,
): PwaLibraryCorePortableFeedReaderResult {
  return Object.freeze({ code, message, ok: false });
}

function intentActorHead(
  actor: PortableIntentActorRecord,
): LibraryCoreIntentHeadV1 {
  return parseLibraryCoreIntentHeadV1({
    actor_id: actor.actorId,
    epoch_id: actor.epochId,
    latest_segment: actor.latestPublishedSegment,
    latest_segment_digest: actor.latestPublishedStoredDigest,
    library_id: actor.libraryId,
    next_intent_sequence: actor.publishedThroughIntentSequence + 1,
    protocol: "intent_head_v1",
    protocol_version: 1,
    schema_version: 1,
  });
}

function intentHeadDigest(
  head: LibraryCoreIntentHeadV1,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    encodeLibraryCoreCanonicalValue(
      head as unknown as LibraryCoreCanonicalValue,
    ),
  );
}

function sameIntentReference(
  left: LibraryCoreImmutableObjectReferenceV1 | null,
  right: LibraryCoreImmutableObjectReferenceV1 | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.transportObjectId === right.transportObjectId &&
      left.descriptor.objectKey === right.descriptor.objectKey &&
      left.descriptor.contentDigest === right.descriptor.contentDigest &&
      left.descriptor.byteLength === right.descriptor.byteLength)
  );
}

function sameIntentTransaction(
  left: PortableIntentTransactionRecord,
  right: PortableIntentTransactionRecord,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.canonicalEnvelopeBytes === right.canonicalEnvelopeBytes &&
    left.epochId === right.epochId &&
    left.firstIntentSequence === right.firstIntentSequence &&
    left.lastIntentSequence === right.lastIntentSequence &&
    left.libraryId === right.libraryId &&
    left.operationCount === right.operationCount &&
    left.transactionDigest === right.transactionDigest &&
    left.transactionId === right.transactionId &&
    left.operationIds.length === right.operationIds.length &&
    left.operationIds.every(
      (operationId, index) => operationId === right.operationIds[index],
    )
  );
}

function sameIntentOperation(
  left: PortableIntentOperationRecord,
  right: PortableIntentOperationRecord,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.envelopeDigest === right.envelopeDigest &&
    left.epochId === right.epochId &&
    left.intentSequence === right.intentSequence &&
    left.libraryId === right.libraryId &&
    left.transactionDigest === right.transactionDigest &&
    left.transactionId === right.transactionId &&
    canonicalStringKey(left.entry as unknown as LibraryCoreCanonicalValue) ===
      canonicalStringKey(right.entry as unknown as LibraryCoreCanonicalValue)
  );
}

function sameIntentPublication(
  left: PortableIntentPublicationRecord,
  right: PortableIntentPublicationRecord,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.bodyDigest === right.bodyDigest &&
    left.epochId === right.epochId &&
    left.expectedHeadDigest === right.expectedHeadDigest &&
    left.firstIntentSequence === right.firstIntentSequence &&
    left.headDigest === right.headDigest &&
    left.lastIntentSequence === right.lastIntentSequence &&
    left.libraryId === right.libraryId &&
    left.storedContentDigest === right.storedContentDigest &&
    sameIntentReference(left.segmentReference, right.segmentReference)
  );
}

function sameIntentResult(
  left: PortableIntentResultRecord,
  right: PortableIntentResultRecord,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.epochId === right.epochId &&
    left.libraryId === right.libraryId &&
    left.resultSequence === right.resultSequence &&
    left.segmentDigest === right.segmentDigest &&
    sameIntentReference(left.segmentReference, right.segmentReference) &&
    canonicalStringKey(left.entry as unknown as LibraryCoreCanonicalValue) ===
      canonicalStringKey(right.entry as unknown as LibraryCoreCanonicalValue)
  );
}

function snapshotIntentEntry(
  entry: LibraryCoreIntentSegmentEntryV1,
): LibraryCoreIntentSegmentEntryV1 {
  return parseLibraryCoreIntentSegmentEntryV1(
    decodeLibraryCoreCanonicalValue(
      encodeLibraryCoreCanonicalValue(
        entry as unknown as LibraryCoreCanonicalValue,
      ),
    ),
  );
}

function readBoundedIntentTransactions(
  request: IDBRequest<IDBCursorWithValue | null>,
  maximumOperations: number,
  maximumCanonicalBytes: number,
): Promise<readonly PortableIntentTransactionRecord[]> {
  return new Promise((resolve, reject) => {
    const transactions: PortableIntentTransactionRecord[] = [];
    let operationCount = 0;
    let canonicalBytes = 0;
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(Object.freeze(transactions));
        return;
      }
      const transaction = cursor.value as PortableIntentTransactionRecord;
      const nextOperationCount = operationCount + transaction.operationCount;
      const nextCanonicalBytes =
        canonicalBytes + transaction.canonicalEnvelopeBytes;
      if (
        nextOperationCount > maximumOperations ||
        nextCanonicalBytes > maximumCanonicalBytes
      ) {
        if (transactions.length === 0) {
          reject(
            new RangeError(
              "the next complete intent transaction exceeds the requested segment bounds",
            ),
          );
        } else {
          resolve(Object.freeze(transactions));
        }
        return;
      }
      transactions.push(transaction);
      operationCount = nextOperationCount;
      canonicalBytes = nextCanonicalBytes;
      cursor.continue();
    });
    request.addEventListener(
      "error",
      () =>
        reject(
          request.error ??
            new Error("PWA Library Core intent transaction cursor failed"),
        ),
      { once: true },
    );
  });
}

function operationEnvelopeBytes(
  entry: LibraryCoreOperationSegmentEntryV1,
): Uint8Array {
  return encodeLibraryCoreCanonicalValue(
    entry.canonical_envelope as LibraryCoreCanonicalValue,
  );
}

function operationEnvelopeRecord(
  entry: LibraryCoreOperationSegmentEntryV1,
): Readonly<Record<string, LibraryCoreCanonicalValue>> {
  const decoded = decodeLibraryCoreCanonicalValue(
    operationEnvelopeBytes(entry),
  );
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    throw new TypeError("operation envelope must be an object");
  }
  return decoded as Readonly<Record<string, LibraryCoreCanonicalValue>>;
}

function transactionMemberIdentity(
  entry: LibraryCoreOperationSegmentEntryV1,
): Readonly<{
  actorId: LibraryCoreLowercaseHex64;
  memberCount: number;
  memberIndex: number;
  transactionId: string;
}> {
  const decoded = operationEnvelopeRecord(entry);
  const actorId = decoded.actor_id;
  const memberCount = decoded.transaction_member_count;
  const memberIndex = decoded.transaction_member_index;
  const transactionId = decoded.transaction_id;
  if (
    typeof actorId !== "string" ||
    !/^[0-9a-f]{64}$/.test(actorId) ||
    !Number.isSafeInteger(memberCount) ||
    (memberCount as number) < 1 ||
    (memberCount as number) > 1_000 ||
    !Number.isSafeInteger(memberIndex) ||
    (memberIndex as number) < 0 ||
    (memberIndex as number) >= (memberCount as number) ||
    typeof transactionId !== "string"
  ) {
    throw new TypeError("operation envelope transaction identity is invalid");
  }
  return Object.freeze({
    actorId: actorId as LibraryCoreLowercaseHex64,
    memberCount: memberCount as number,
    memberIndex: memberIndex as number,
    transactionId,
  });
}

function causalTipIdentity(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("operation causal frontier tip is invalid");
  }
  const tip = value as Readonly<Record<string, unknown>>;
  if (
    typeof tip.actor_id !== "string" ||
    !Number.isSafeInteger(tip.sequence) ||
    typeof tip.operation_id !== "string" ||
    typeof tip.chain_digest !== "string"
  ) {
    throw new TypeError("operation causal frontier tip is invalid");
  }
  return [tip.actor_id, tip.sequence, tip.operation_id, tip.chain_digest].join(
    "\u0000",
  );
}

/**
 * Dormant IndexedDB materialization for complete adapter-neutral Library Core
 * checkpoints. Automerge remains authoritative and no product reader selects
 * this database before the governed replacement-protocol cutover.
 */
class PwaLibraryCorePortableCheckpointStore
  implements
    LibraryCorePortableCheckpointImportWriterV1,
    LibraryCoreOperationSegmentImportWriterV1
{
  readonly #databaseName: string;
  readonly #indexedDb: IDBFactory;
  readonly #keyRange: typeof IDBKeyRange;
  readonly #subtle: SubtleCrypto;
  readonly #now: () => number;
  readonly #randomBytes: (byteLength: number) => Uint8Array;
  readonly #feedSessions = new Map<string, PortableFeedReaderSession>();
  #databasePromise: Promise<IDBDatabase> | null = null;
  #activeGenerationId: LibraryCoreLowercaseHex64 | null = null;
  #quiesced = false;

  constructor(options: PwaLibraryCorePortableCheckpointStoreOptions) {
    if (!options.databaseName) {
      throw new TypeError("PWA Library Core database name is required");
    }
    this.#databaseName = options.databaseName;
    this.#indexedDb = options.indexedDb;
    this.#keyRange = options.keyRange;
    this.#subtle = options.subtle;
    this.#now = options.now ?? Date.now;
    this.#randomBytes =
      options.randomBytes ??
      ((byteLength) => {
        const bytes = new Uint8Array(byteLength);
        globalThis.crypto.getRandomValues(bytes);
        return bytes;
      });
  }

  async readSelectedAcceptedAuthorityState(): Promise<LibraryCoreAcceptedAuthorityStateV1 | null> {
    this.#requireAvailable();
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, CONTROL_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    await transactionDone(transaction);
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header?.anchor_kind !== "accepted_authority"
    ) {
      return null;
    }
    return generation.header.accepted_authority;
  }

  /**
   * Prepare one stable, proof-only enrollment request for the active cloud
   * authority. The Ed25519 private key remains nonextractable in IndexedDB.
   */
  async preparePwaActorEnrollmentRequest(): Promise<PwaLibraryCoreActorEnrollmentRequestCandidateV1 | null> {
    this.#requireAvailable();
    const database = await this.#database();
    const readTransaction = database.transaction(
      [
        GENERATIONS_STORE,
        CONTROL_STORE,
        ACTOR_TIPS_STORE,
        PWA_ACTOR_IDENTITIES_STORE,
      ],
      "readonly",
    );
    const selected = (await requestResult(
      readTransaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          readTransaction
            .objectStore(GENERATIONS_STORE)
            .get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    const existingIdentity = generation
      ? ((await requestResult(
          readTransaction
            .objectStore(PWA_ACTOR_IDENTITIES_STORE)
            .get(generation.libraryId),
        )) as PortablePwaActorIdentityRecord | undefined)
      : undefined;
    const acceptedActor =
      generation && existingIdentity
        ? ((await requestResult(
            readTransaction
              .objectStore(ACTOR_TIPS_STORE)
              .get([generation.generationId, existingIdentity.actorId]),
          )) as PortableActorTipRecord | undefined)
        : undefined;
    await transactionDone(readTransaction);
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header?.anchor_kind !== "accepted_authority" ||
      generation.header.accepted_authority === null
    ) {
      throw new Error(
        "PWA actor enrollment requires a selected accepted-authority checkpoint",
      );
    }

    const authority = generation.header.accepted_authority;
    if (acceptedActor && !acceptedActor.retired) return null;
    const authorityStateDigest = await this.#canonicalDigest(
      authority as unknown as LibraryCoreCanonicalValue,
    );
    const existingRequestTransaction = database.transaction(
      PWA_ACTOR_ENROLLMENT_REQUESTS_STORE,
      "readonly",
    );
    const existingRequest = (await requestResult(
      existingRequestTransaction
        .objectStore(PWA_ACTOR_ENROLLMENT_REQUESTS_STORE)
        .get([generation.libraryId, authorityStateDigest]),
    )) as PortablePwaActorEnrollmentRequestRecord | undefined;
    await transactionDone(existingRequestTransaction);
    if (existingRequest && existingIdentity) {
      return this.#actorEnrollmentCandidate(
        authority,
        authorityStateDigest,
        existingRequest.actorId,
        existingRequest.request,
        existingRequest.canonicalBytes,
        existingRequest.publishedReference,
      );
    }

    const identity =
      existingIdentity ??
      (await this.#createPwaActorIdentity(generation.libraryId));
    const operationId =
      `pwa-enroll:${identity.actorId}:${authorityStateDigest.slice(0, 32)}` as LibraryCoreOperationInstanceId;
    const body = constructLibraryCoreActorEnrollmentBodyV1(
      {
        operation_id: operationId,
        library_id: authority.library_id,
        epoch: authority.epoch,
        epoch_id: authority.epoch_id,
        authority_key_id: authority.authority_key_id,
        installation_incarnation: identity.installationIncarnation,
        actor_incarnation_nonce: identity.actorIncarnationNonce,
        actor_public_key: identity.actorPublicKey,
        observed_frontier: authority.observed_frontier,
        created_at_ms: this.#now(),
      },
      { digest: libraryCoreDigest },
    );
    if (body.body.actor_id !== identity.actorId) {
      throw new Error(
        "stored PWA actor identity does not match its public key",
      );
    }
    const request = await constructLibraryCoreActorEnrollmentRequestV1(body, {
      digest: libraryCoreDigest,
      signActorProof: async (message) =>
        lowerHex(
          await this.#subtle.sign(
            { name: "Ed25519" },
            identity.actorPrivateKey,
            exactArrayBuffer(message),
          ),
        ) as LibraryCoreEd25519SignatureHex,
    });
    const canonicalBytes = encodeLibraryCoreCanonicalValue(
      request as unknown as LibraryCoreCanonicalValue,
    );
    const requestRecord = Object.freeze({
      actorId: identity.actorId,
      authorityStateDigest,
      canonicalBytes,
      epochId: authority.epoch_id as unknown as LibraryCoreOperationInstanceId,
      libraryId: generation.libraryId,
      publishedReference: null,
      request,
      schemaVersion: 1,
    }) satisfies PortablePwaActorEnrollmentRequestRecord;
    const writeTransaction = database.transaction(
      [PWA_ACTOR_IDENTITIES_STORE, PWA_ACTOR_ENROLLMENT_REQUESTS_STORE],
      "readwrite",
    );
    if (!existingIdentity) {
      writeTransaction.objectStore(PWA_ACTOR_IDENTITIES_STORE).add(identity);
    }
    writeTransaction
      .objectStore(PWA_ACTOR_ENROLLMENT_REQUESTS_STORE)
      .add(requestRecord);
    await transactionDone(writeTransaction);
    return this.#actorEnrollmentCandidate(
      authority,
      authorityStateDigest,
      identity.actorId,
      request,
      canonicalBytes,
      null,
    );
  }

  async recordPwaActorEnrollmentRequestPublication(input: {
    readonly actorId: LibraryCoreLowercaseHex64;
    readonly authorityStateDigest: LibraryCoreLowercaseHex64;
    readonly libraryId: LibraryCoreOperationInstanceId;
    readonly reference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<"already_recorded" | "recorded"> {
    this.#requireAvailable();
    const reference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.reference),
    );
    const database = await this.#database();
    const transaction = database.transaction(
      PWA_ACTOR_ENROLLMENT_REQUESTS_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(PWA_ACTOR_ENROLLMENT_REQUESTS_STORE);
    const record = (await requestResult(
      store.get([input.libraryId, input.authorityStateDigest]),
    )) as PortablePwaActorEnrollmentRequestRecord | undefined;
    if (
      !record ||
      record.actorId !== input.actorId ||
      record.authorityStateDigest !== input.authorityStateDigest ||
      record.canonicalBytes.byteLength !== reference.descriptor.byteLength ||
      sha256LowerHex(record.canonicalBytes) !==
        reference.descriptor.contentDigest
    ) {
      transaction.abort();
      throw new Error(
        "PWA actor enrollment publication does not match its request",
      );
    }
    if (record.publishedReference) {
      if (
        record.publishedReference.transportObjectId !==
          reference.transportObjectId ||
        record.publishedReference.descriptor.objectKey !==
          reference.descriptor.objectKey ||
        record.publishedReference.descriptor.contentDigest !==
          reference.descriptor.contentDigest
      ) {
        transaction.abort();
        throw new Error(
          "PWA actor enrollment request was published under another identity",
        );
      }
      await transactionDone(transaction);
      return "already_recorded";
    }
    store.put({
      ...record,
      publishedReference: reference,
    } satisfies PortablePwaActorEnrollmentRequestRecord);
    await transactionDone(transaction);
    return "recorded";
  }

  async #createPwaActorIdentity(
    libraryId: LibraryCoreOperationInstanceId,
  ): Promise<PortablePwaActorIdentityRecord> {
    const generated = (await this.#subtle.generateKey(
      { name: "Ed25519" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    if (
      generated.privateKey.extractable ||
      generated.privateKey.type !== "private" ||
      !generated.privateKey.usages.includes("sign")
    ) {
      throw new Error(
        "PWA actor private key is not nonextractable signing key",
      );
    }
    const actorPublicKey = lowerHex(
      await this.#subtle.exportKey("raw", generated.publicKey),
    ) as LibraryCoreEd25519PublicKeyHex;
    const installationIncarnation = this.#randomHex64();
    const actorIncarnationNonce = this.#randomHex64();
    const actorId = libraryCoreDigest("actor-id", {
      library_id: libraryId,
      installation_incarnation: installationIncarnation,
      signature_algorithm: "ed25519",
      actor_public_key: actorPublicKey,
      actor_incarnation_nonce: actorIncarnationNonce,
    });
    return Object.freeze({
      actorId,
      actorIncarnationNonce,
      actorPrivateKey: generated.privateKey,
      actorPublicKey,
      installationIncarnation,
      libraryId,
      schemaVersion: 1,
    });
  }

  #randomHex64(): LibraryCoreLowercaseHex64 {
    const bytes = this.#randomBytes(32);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
      throw new Error("PWA actor randomness must return exactly 32 bytes");
    }
    return lowerHex(exactArrayBuffer(bytes)) as LibraryCoreLowercaseHex64;
  }

  #actorEnrollmentCandidate(
    authority: LibraryCoreAcceptedAuthorityStateV1,
    authorityStateDigest: LibraryCoreLowercaseHex64,
    actorId: LibraryCoreLowercaseHex64,
    request: LibraryCoreActorEnrollmentRequestV1,
    canonicalBytesInput: Uint8Array,
    publishedReference: LibraryCoreImmutableObjectReferenceV1 | null,
  ): PwaLibraryCoreActorEnrollmentRequestCandidateV1 {
    const canonicalBytes = new Uint8Array(canonicalBytesInput);
    const contentDigest = sha256LowerHex(canonicalBytes);
    return Object.freeze({
      acceptedAuthorityState: authority,
      actorId,
      authorityStateDigest,
      immutableObject: Object.freeze({
        descriptor: Object.freeze({
          byteLength: canonicalBytes.byteLength,
          contentDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            actorId,
            digest: contentDigest,
            epochId: authority.epoch_id,
            kind: "actor_enrollment_request",
            libraryId: authority.library_id,
          }),
        }),
        source: canonicalBytes,
      }),
      publishedReference,
      request,
    });
  }

  async beginImport(input: {
    readonly manifest: LibraryCoreCheckpointManifestV1;
    readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<"already_complete" | "import"> {
    this.#requireAvailable();
    const manifest = parseLibraryCoreCheckpointManifestV1(input.manifest);
    if (manifest.datasetSchemaId !== "library_core_logical_checkpoint_v1") {
      throw new TypeError(
        "PWA Library Core store requires a logical checkpoint manifest",
      );
    }
    const reference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.manifestReference),
    );
    assertManifestReference(manifest, reference);
    const generationId = reference.descriptor.contentDigest;
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, CONTROL_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const control = transaction.objectStore(CONTROL_STORE);
    const existing = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (existing) {
      if (!generationMatches(existing, manifest, reference)) {
        transaction.abort();
        throw new Error(
          "portable checkpoint identity already exists with different state",
        );
      }
      if (existing.status === "complete") {
        const selected = (await requestResult(
          control.get(SELECTED_GENERATION_KEY),
        )) as SelectedPortableGenerationRecord | undefined;
        if (
          selected?.generationId === generationId &&
          existing.selectionSequence !== selected.selectionSequence
        ) {
          transaction.abort();
          throw new Error(
            "portable checkpoint selection sequence is inconsistent",
          );
        }
        if (selected?.generationId !== generationId) {
          const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
          if (!Number.isSafeInteger(selectionSequence)) {
            transaction.abort();
            throw new Error("portable checkpoint selection sequence exhausted");
          }
          generations.put({
            ...existing,
            selectionSequence,
          } satisfies PortableGenerationRecord);
          control.put({
            key: SELECTED_GENERATION_KEY,
            generationId,
            selectionSequence,
          } satisfies SelectedPortableGenerationRecord);
        }
        await transactionDone(transaction);
        this.#activeGenerationId = null;
        return "already_complete";
      }
      await transactionDone(transaction);
      this.#activeGenerationId = generationId;
      return "import";
    }

    const allGenerations = (await requestResult(
      generations.getAll(),
    )) as PortableGenerationRecord[];
    if (allGenerations.some((generation) => generation.status === "staging")) {
      transaction.abort();
      throw new Error(
        "another PWA Library Core portable checkpoint is still staging",
      );
    }
    generations.add({
      authenticatedFrontierDigest: manifest.causalFrontierDigest,
      authenticatedThroughIngestSequence: 0,
      checkpointFrontierDigest: manifest.causalFrontierDigest,
      frontierDigest: manifest.causalFrontierDigest,
      generationId,
      header: null,
      headerDigest: null,
      importedThroughIngestSequence: 0,
      libraryId: manifest.libraryId,
      latestOperationSegmentDigest: null,
      latestAuthenticatedSegmentDigest: null,
      manifestGeneration: manifest.generation,
      manifestObjectKey: reference.descriptor.objectKey,
      manifestPageCount: manifest.pages.length,
      manifestStoredByteLength: reference.descriptor.byteLength,
      manifestTransportObjectId: reference.transportObjectId,
      nextPageIndex: 0,
      selectionSequence: null,
      status: "staging",
      storageEpoch: manifest.storageEpoch,
      totalRecordCount: manifest.totalRecordCount,
      visibleFeedRowCount: 0,
      writtenRecordCount: 0,
    } satisfies PortableGenerationRecord);
    await transactionDone(transaction);
    this.#activeGenerationId = generationId;
    return "import";
  }

  async appendPage(
    pageIndex: number,
    inputRecords: readonly LibraryCorePortableCheckpointRecordV1[],
  ): Promise<void> {
    this.#requireAvailable();
    const generationId = this.#requireActiveGeneration();
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
      throw new TypeError(
        "portable checkpoint pageIndex must be nonnegative and safe",
      );
    }
    const records = Object.freeze(
      inputRecords.map((record) =>
        parseLibraryCorePortableCheckpointRecordV1(record),
      ),
    );
    if (records.length === 0 || records.length > MAXIMUM_COLLECTION_PAGE_ROWS) {
      throw new RangeError(
        `portable checkpoint page must contain 1 through ${MAXIMUM_COLLECTION_PAGE_ROWS.toLocaleString()} records`,
      );
    }
    const pageDigest = await this.#canonicalDigest(
      records as unknown as LibraryCoreCanonicalValue,
    );
    const header = records.find(
      (record): record is LibraryCorePortableCheckpointHeaderV1 =>
        record.kind === "logical_checkpoint_header",
    );
    const headerDigest = header
      ? await this.#canonicalDigest(
          header as unknown as LibraryCoreCanonicalValue,
        )
      : null;

    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        RECORDS_STORE,
        PAGES_STORE,
        ACTOR_TIPS_STORE,
        MATERIALIZED_ROWS_STORE,
        FEED_ROWS_STORE,
      ],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const pages = transaction.objectStore(PAGES_STORE);
    const entries = transaction.objectStore(RECORDS_STORE);
    const actorTips = transaction.objectStore(ACTOR_TIPS_STORE);
    const materializedRows = transaction.objectStore(MATERIALIZED_ROWS_STORE);
    const feedRows = transaction.objectStore(FEED_ROWS_STORE);
    const generation = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (!generation || generation.status !== "staging") {
      transaction.abort();
      throw new Error(
        "portable checkpoint generation is absent or no longer staging",
      );
    }

    const existingPage = (await requestResult(
      pages.get([generationId, pageIndex]),
    )) as PortablePageRecord | undefined;
    if (existingPage) {
      if (
        existingPage.pageDigest === pageDigest &&
        existingPage.recordCount === records.length &&
        existingPage.writtenRecordCountAfter <= generation.writtenRecordCount &&
        generation.nextPageIndex > pageIndex
      ) {
        await transactionDone(transaction);
        return;
      }
      transaction.abort();
      throw new Error(
        "portable checkpoint page replay changed its exact records",
      );
    }
    if (
      generation.nextPageIndex !== pageIndex ||
      generation.writtenRecordCount + records.length >
        generation.totalRecordCount
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint page is skipped, reordered, or oversized",
      );
    }
    if (
      generation.writtenRecordCount === 0
        ? pageIndex !== 0 ||
          records[0]?.kind !== "logical_checkpoint_header" ||
          header === undefined
        : header !== undefined
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint header is missing, repeated, or out of order",
      );
    }
    if (
      header &&
      (header.library_id !== generation.libraryId ||
        header.epoch_id !== generation.storageEpoch ||
        header.materializer_position.frontier_digest !==
          generation.frontierDigest)
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint header does not match its staging generation",
      );
    }

    let visibleFeedRowsAdded = 0;
    for (const record of records) {
      if (record.kind !== "logical_checkpoint_entry") continue;
      entries.add({
        collection: record.collection,
        entry: record,
        generationId,
        ordinal: record.ordinal,
      } satisfies PortableEntryRecord);
      if (record.collection === "actor_states") {
        const value = record.value as Readonly<Record<string, unknown>>;
        actorTips.add({
          acceptedChainDigest:
            value.accepted_chain_digest as LibraryCoreLowercaseHex64,
          acceptedOperationId:
            value.accepted_operation_id as LibraryCoreOperationInstanceId | null,
          acceptedSequence: value.accepted_sequence as number,
          actorId: value.actor_id as LibraryCoreLowercaseHex64,
          enrollmentCertificateDigest:
            value.enrollment_certificate_digest as LibraryCoreLowercaseHex64,
          generationId,
          retired: value.retired as boolean,
        } satisfies PortableActorTipRecord);
      }
      if (record.collection === "materialized_rows") {
        const value = record.value as Readonly<Record<string, unknown>>;
        const materialized = {
          generationId,
          primaryKey: canonicalStringKey(
            value.primary_key as LibraryCoreCanonicalValue,
          ),
          registryKey: value.registry_key as string,
          row: value.row as Readonly<Record<string, LibraryCoreCanonicalValue>>,
        } satisfies PortableMaterializedRowRecord;
        materializedRows.add(materialized);
        const feedRow = projectPortableFeedRow(generationId, materialized);
        if (feedRow) {
          feedRows.add(feedRow);
          visibleFeedRowsAdded += 1;
        }
      }
    }
    const writtenRecordCountAfter =
      generation.writtenRecordCount + records.length;
    pages.add({
      generationId,
      pageDigest,
      pageIndex,
      recordCount: records.length,
      writtenRecordCountAfter,
    } satisfies PortablePageRecord);
    generations.put({
      ...generation,
      header: header ?? generation.header,
      headerDigest: headerDigest ?? generation.headerDigest,
      nextPageIndex: pageIndex + 1,
      visibleFeedRowCount:
        generation.visibleFeedRowCount + visibleFeedRowsAdded,
      writtenRecordCount: writtenRecordCountAfter,
    } satisfies PortableGenerationRecord);
    await transactionDone(transaction);
  }

  async finalizeImport(input: {
    readonly header: LibraryCorePortableCheckpointHeaderV1;
    readonly manifest: LibraryCoreCheckpointManifestV1;
    readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCorePortableCheckpointStagingReceiptV1> {
    this.#requireAvailable();
    const generationId = this.#requireActiveGeneration();
    const manifest = parseLibraryCoreCheckpointManifestV1(input.manifest);
    const manifestReference = parseLibraryCoreImmutableObjectReferenceV1(
      input.manifestReference,
    );
    assertManifestReference(manifest, manifestReference);
    if (generationId !== manifestReference.descriptor.contentDigest) {
      throw new Error(
        "portable checkpoint finalization changed its active generation",
      );
    }
    const header = parseLibraryCorePortableCheckpointRecordV1(input.header);
    if (header.kind !== "logical_checkpoint_header") {
      throw new TypeError("portable checkpoint finalization header is invalid");
    }
    const headerDigest = await this.#canonicalDigest(
      header as unknown as LibraryCoreCanonicalValue,
    );

    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        RECORDS_STORE,
        PAGES_STORE,
        OPERATIONS_STORE,
        SEGMENTS_STORE,
        ACTOR_ENROLLMENTS_STORE,
        ACTOR_TIPS_STORE,
        AUTHENTICATED_OPERATIONS_STORE,
        AUTHENTICATED_SEGMENTS_STORE,
        MATERIALIZED_ROWS_STORE,
        READ_STATE_STORE,
        FEED_ROWS_STORE,
        CONTROL_STORE,
      ],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const entries = transaction.objectStore(RECORDS_STORE);
    const pages = transaction.objectStore(PAGES_STORE);
    const control = transaction.objectStore(CONTROL_STORE);
    const generation = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (
      !generation ||
      generation.status !== "staging" ||
      !generationMatches(generation, manifest, manifestReference) ||
      generation.headerDigest !== headerDigest ||
      generation.writtenRecordCount !== generation.totalRecordCount ||
      generation.nextPageIndex !== generation.manifestPageCount
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint staging generation is incomplete or mismatched",
      );
    }

    const entryCountRequest = entries.count(
      entriesRange(this.#keyRange, generationId),
    );
    const pageCountRequest = pages.count(
      this.#keyRange.bound(
        [generationId, 0],
        [generationId, Number.MAX_SAFE_INTEGER],
      ),
    );
    const collectionCountRequests =
      LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.map((collection) =>
        entries.count(
          collectionRange(this.#keyRange, generationId, collection),
        ),
      );
    const [entryCount, pageCount, collectionCounts] = await Promise.all([
      requestResult(entryCountRequest),
      requestResult(pageCountRequest),
      Promise.all(collectionCountRequests.map(requestResult)),
    ]);
    if (
      entryCount !== generation.totalRecordCount - 1 ||
      pageCount !== generation.manifestPageCount ||
      collectionCounts.some(
        (count, index) =>
          count !==
          header.collection_counts[
            LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS[index]!
          ],
      )
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint staged row counts do not match its verified header",
      );
    }

    const selected = (await requestResult(
      control.get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
    if (!Number.isSafeInteger(selectionSequence)) {
      transaction.abort();
      throw new Error("portable checkpoint selection sequence exhausted");
    }
    generations.put({
      ...generation,
      authenticatedFrontierDigest: header.materializer_position.frontier_digest,
      authenticatedThroughIngestSequence:
        header.materializer_position.ingest_sequence,
      importedThroughIngestSequence:
        header.materializer_position.ingest_sequence,
      latestAuthenticatedSegmentDigest: null,
      latestOperationSegmentDigest: null,
      selectionSequence,
      status: "complete",
    } satisfies PortableGenerationRecord);
    control.put({
      key: SELECTED_GENERATION_KEY,
      generationId,
      selectionSequence,
    } satisfies SelectedPortableGenerationRecord);

    const allGenerations = (await requestResult(
      generations.getAll(),
    )) as PortableGenerationRecord[];
    const obsolete = allGenerations
      .filter(
        (candidate) =>
          candidate.status === "complete" &&
          candidate.generationId !== generationId,
      )
      .sort(
        (left, right) =>
          (right.selectionSequence ?? -1) - (left.selectionSequence ?? -1),
      )
      .slice(MAXIMUM_RETAINED_GENERATIONS - 1);
    for (const candidate of obsolete) {
      entries.delete(entriesRange(this.#keyRange, candidate.generationId));
      transaction
        .objectStore(OPERATIONS_STORE)
        .delete(
          this.#keyRange.bound(
            [candidate.generationId, 0],
            [candidate.generationId, Number.MAX_SAFE_INTEGER],
          ),
        );
      transaction
        .objectStore(SEGMENTS_STORE)
        .delete(
          this.#keyRange.bound(
            [candidate.generationId, 0],
            [candidate.generationId, Number.MAX_SAFE_INTEGER],
          ),
        );
      for (const storeName of [
        ACTOR_ENROLLMENTS_STORE,
        ACTOR_TIPS_STORE,
        AUTHENTICATED_OPERATIONS_STORE,
        AUTHENTICATED_SEGMENTS_STORE,
        MATERIALIZED_ROWS_STORE,
        READ_STATE_STORE,
        FEED_ROWS_STORE,
      ]) {
        transaction
          .objectStore(storeName)
          .delete(
            this.#keyRange.bound(
              [candidate.generationId],
              [candidate.generationId, []],
            ),
          );
      }
      pages.delete(
        this.#keyRange.bound(
          [candidate.generationId, 0],
          [candidate.generationId, Number.MAX_SAFE_INTEGER],
        ),
      );
      generations.delete(candidate.generationId);
    }

    await transactionDone(transaction);
    this.#feedSessions.clear();
    this.#activeGenerationId = null;
    return Object.freeze({
      frontierDigest: header.materializer_position.frontier_digest,
      ingestSequence: header.materializer_position.ingest_sequence,
      libraryId: header.library_id,
      materializedDigest: header.materializer_position.materialized_digest,
      recordCount: generation.totalRecordCount,
      storageEpoch: header.epoch_id,
    });
  }

  async abortImport(): Promise<void> {
    const generationId = this.#activeGenerationId;
    this.#activeGenerationId = null;
    if (generationId === null || this.#quiesced) return;
    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        RECORDS_STORE,
        PAGES_STORE,
        ACTOR_TIPS_STORE,
        MATERIALIZED_ROWS_STORE,
        FEED_ROWS_STORE,
      ],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const generation = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (generation?.status === "staging") {
      transaction
        .objectStore(RECORDS_STORE)
        .delete(entriesRange(this.#keyRange, generationId));
      transaction
        .objectStore(PAGES_STORE)
        .delete(
          this.#keyRange.bound(
            [generationId, 0],
            [generationId, Number.MAX_SAFE_INTEGER],
          ),
        );
      transaction
        .objectStore(ACTOR_TIPS_STORE)
        .delete(this.#keyRange.bound([generationId], [generationId, []]));
      transaction
        .objectStore(MATERIALIZED_ROWS_STORE)
        .delete(this.#keyRange.bound([generationId], [generationId, []]));
      transaction
        .objectStore(FEED_ROWS_STORE)
        .delete(this.#keyRange.bound([generationId], [generationId, []]));
      generations.delete(generationId);
    }
    await transactionDone(transaction);
  }

  async installActorEnrollment(input: {
    readonly acceptedAuthorityState: LibraryCoreAcceptedAuthorityStateV1;
    readonly certificateBytes: Uint8Array;
  }): Promise<"installed" | "already_installed"> {
    this.#requireAvailable();
    const verified = await verifyLibraryCoreActorEnrollmentCertificateV1(
      input.certificateBytes,
      input.acceptedAuthorityState,
      {
        digest: libraryCoreDigest,
        verifySignature: (verification) =>
          verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
      },
    );
    const body = verified.certificate.certificate_body.actor_enrollment_body;
    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        CONTROL_STORE,
        ACTOR_TIPS_STORE,
        ACTOR_ENROLLMENTS_STORE,
      ],
      "readwrite",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    const actorTip = selected
      ? ((await requestResult(
          transaction
            .objectStore(ACTOR_TIPS_STORE)
            .get([selected.generationId, body.actor_id]),
        )) as PortableActorTipRecord | undefined)
      : undefined;
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      String(generation.libraryId) !== body.library_id ||
      String(generation.storageEpoch) !== body.epoch_id ||
      generation.header?.epoch !== body.epoch ||
      !actorTip ||
      actorTip.retired ||
      actorTip.enrollmentCertificateDigest !==
        verified.certificate.certificate_digest
    ) {
      transaction.abort();
      throw new Error(
        "actor enrollment does not match an active checkpoint actor",
      );
    }
    const enrollments = transaction.objectStore(ACTOR_ENROLLMENTS_STORE);
    const existing = (await requestResult(
      enrollments.get([selected.generationId, body.actor_id]),
    )) as PortableActorEnrollmentRecord | undefined;
    if (existing) {
      if (
        existing.certificateDigest ===
          verified.certificate.certificate_digest &&
        existing.actorPublicKey === body.actor_public_key &&
        existing.actorChainGenesis === verified.actor_chain_genesis
      ) {
        await transactionDone(transaction);
        return "already_installed";
      }
      transaction.abort();
      throw new Error(
        "actor enrollment identity already exists with different bytes",
      );
    }
    enrollments.add({
      actorChainGenesis: verified.actor_chain_genesis,
      actorId: body.actor_id,
      actorPublicKey: body.actor_public_key,
      certificateDigest: verified.certificate.certificate_digest,
      generationId: selected.generationId,
    } satisfies PortableActorEnrollmentRecord);
    await transactionDone(transaction);
    return "installed";
  }

  async appendAuthenticatedOperationSegment(input: {
    readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
    readonly header: LibraryCoreOperationSegmentHeaderV1;
    readonly reference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCoreOperationSegmentImportReceiptV1> {
    this.#requireAvailable();
    const header = parseLibraryCoreOperationSegmentHeaderV1(input.header);
    const entries = Object.freeze(
      input.entries.map(parseLibraryCoreOperationSegmentEntryV1),
    );
    const reference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.reference),
    );
    const groups: Array<{
      readonly actorId: LibraryCoreLowercaseHex64;
      readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
    }> = [];
    for (let index = 0; index < entries.length;) {
      const identity = transactionMemberIdentity(entries[index]!);
      if (
        identity.memberIndex !== 0 ||
        index + identity.memberCount > entries.length
      ) {
        throw new Error(
          "authenticated operation segments must contain complete transactions",
        );
      }
      const members = entries.slice(index, index + identity.memberCount);
      for (
        let memberIndex = 0;
        memberIndex < members.length;
        memberIndex += 1
      ) {
        const member = transactionMemberIdentity(members[memberIndex]!);
        if (
          member.actorId !== identity.actorId ||
          member.transactionId !== identity.transactionId ||
          member.memberCount !== identity.memberCount ||
          member.memberIndex !== memberIndex
        ) {
          throw new Error(
            "authenticated operation segment transaction members are split or reordered",
          );
        }
      }
      groups.push(
        Object.freeze({
          actorId: identity.actorId,
          entries: Object.freeze(members),
        }),
      );
      index += identity.memberCount;
    }

    const database = await this.#database();
    const snapshotTransaction = database.transaction(
      [
        GENERATIONS_STORE,
        CONTROL_STORE,
        ACTOR_TIPS_STORE,
        ACTOR_ENROLLMENTS_STORE,
        AUTHENTICATED_OPERATIONS_STORE,
        AUTHENTICATED_SEGMENTS_STORE,
        RECORDS_STORE,
        SEGMENTS_STORE,
      ],
      "readonly",
    );
    const selected = (await requestResult(
      snapshotTransaction
        .objectStore(CONTROL_STORE)
        .get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          snapshotTransaction
            .objectStore(GENERATIONS_STORE)
            .get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header === null ||
      header.library_id !== generation.libraryId ||
      header.epoch_id !== generation.storageEpoch
    ) {
      snapshotTransaction.abort();
      throw new Error(
        "authenticated operation segment has no matching selected checkpoint",
      );
    }
    const existingAuthenticated = (await requestResult(
      snapshotTransaction
        .objectStore(AUTHENTICATED_SEGMENTS_STORE)
        .get([generation.generationId, header.first_ingest_sequence]),
    )) as PortableAuthenticatedSegmentRecord | undefined;
    if (existingAuthenticated) {
      if (
        existingAuthenticated.header.segment_digest === header.segment_digest &&
        existingAuthenticated.lastIngestSequence ===
          header.last_ingest_sequence &&
        existingAuthenticated.objectKey === reference.descriptor.objectKey &&
        existingAuthenticated.storedByteLength ===
          reference.descriptor.byteLength &&
        existingAuthenticated.storedContentDigest ===
          reference.descriptor.contentDigest &&
        existingAuthenticated.transportObjectId === reference.transportObjectId
      ) {
        await transactionDone(snapshotTransaction);
        return this.#segmentReceipt(header);
      }
      snapshotTransaction.abort();
      throw new Error(
        "authenticated operation segment identity already exists with different bytes",
      );
    }
    if (
      header.first_ingest_sequence !==
        generation.authenticatedThroughIngestSequence + 1 ||
      header.base_frontier_digest !== generation.authenticatedFrontierDigest ||
      header.previous_segment_digest !==
        generation.latestAuthenticatedSegmentDigest
    ) {
      snapshotTransaction.abort();
      throw new Error(
        "authenticated operation segment does not extend the admitted frontier",
      );
    }

    const tipSnapshots = new Map<
      LibraryCoreLowercaseHex64,
      PortableActorTipRecord
    >();
    const enrollments = new Map<
      LibraryCoreLowercaseHex64,
      PortableActorEnrollmentRecord
    >();
    for (const actorId of new Set(groups.map((group) => group.actorId))) {
      const tip = (await requestResult(
        snapshotTransaction
          .objectStore(ACTOR_TIPS_STORE)
          .get([generation.generationId, actorId]),
      )) as PortableActorTipRecord | undefined;
      const enrollment = (await requestResult(
        snapshotTransaction
          .objectStore(ACTOR_ENROLLMENTS_STORE)
          .get([generation.generationId, actorId]),
      )) as PortableActorEnrollmentRecord | undefined;
      if (
        !tip ||
        tip.retired ||
        !enrollment ||
        enrollment.certificateDigest !== tip.enrollmentCertificateDigest
      ) {
        snapshotTransaction.abort();
        throw new Error(
          "authenticated operation actor is absent, retired, or unenrolled",
        );
      }
      tipSnapshots.set(actorId, tip);
      enrollments.set(actorId, enrollment);
    }
    const rawExisting = (await requestResult(
      snapshotTransaction
        .objectStore(SEGMENTS_STORE)
        .get([generation.generationId, header.first_ingest_sequence]),
    )) as PortableSegmentRecord | undefined;
    if (
      rawExisting &&
      (rawExisting.header.segment_digest !== header.segment_digest ||
        rawExisting.lastIngestSequence !== header.last_ingest_sequence ||
        rawExisting.objectKey !== reference.descriptor.objectKey ||
        rawExisting.storedByteLength !== reference.descriptor.byteLength ||
        rawExisting.storedContentDigest !==
          reference.descriptor.contentDigest ||
        rawExisting.transportObjectId !== reference.transportObjectId)
    ) {
      snapshotTransaction.abort();
      throw new Error(
        "stored operation segment bytes do not match authenticated input",
      );
    }
    const knownCausalTips = new Set<string>();
    const allActorTips = (await requestResult(
      snapshotTransaction
        .objectStore(ACTOR_TIPS_STORE)
        .getAll(
          this.#keyRange.bound(
            [generation.generationId],
            [generation.generationId, []],
          ),
        ),
    )) as PortableActorTipRecord[];
    for (const tip of allActorTips) {
      if (tip.acceptedSequence === 0 || tip.acceptedOperationId === null) {
        continue;
      }
      knownCausalTips.add(
        [
          tip.actorId,
          tip.acceptedSequence,
          tip.acceptedOperationId,
          tip.acceptedChainDigest,
        ].join("\u0000"),
      );
    }
    const frontierCursorRequest = snapshotTransaction
      .objectStore(RECORDS_STORE)
      .openCursor(
        collectionRange(
          this.#keyRange,
          generation.generationId,
          "accepted_frontier",
        ),
      );
    let frontierCursor = await requestResult(frontierCursorRequest);
    while (frontierCursor) {
      const stored = frontierCursor.value as PortableEntryRecord;
      knownCausalTips.add(causalTipIdentity(stored.entry.value));
      frontierCursor.continue();
      frontierCursor = await requestResult(frontierCursor.request);
    }
    const requestedTips = new Map<
      string,
      Readonly<{
        actorId: string;
        chainDigest: string;
        operationId: string;
        sequence: number;
      }>
    >();
    for (const entry of entries) {
      const envelope = operationEnvelopeRecord(entry);
      if (!Array.isArray(envelope.causal_frontier)) {
        snapshotTransaction.abort();
        throw new TypeError("operation causal frontier must be an array");
      }
      for (const tip of envelope.causal_frontier) {
        const identity = causalTipIdentity(tip);
        if (typeof tip !== "object" || tip === null || Array.isArray(tip)) {
          snapshotTransaction.abort();
          throw new TypeError("operation causal frontier tip is invalid");
        }
        requestedTips.set(
          identity,
          Object.freeze({
            actorId: tip.actor_id as string,
            chainDigest: tip.chain_digest as string,
            operationId: tip.operation_id as string,
            sequence: tip.sequence as number,
          }),
        );
      }
    }
    const authenticatedOperationIndex = snapshotTransaction
      .objectStore(AUTHENTICATED_OPERATIONS_STORE)
      .index("by_generation_operation_id");
    for (const [identity, tip] of requestedTips) {
      if (knownCausalTips.has(identity)) continue;
      const operation = (await requestResult(
        authenticatedOperationIndex.get([
          generation.generationId,
          tip.operationId,
        ]),
      )) as PortableAuthenticatedOperationRecord | undefined;
      if (
        operation?.actorId === tip.actorId &&
        operation.actorSequence === tip.sequence &&
        operation.actorChainDigest === tip.chainDigest
      ) {
        knownCausalTips.add(identity);
      }
    }
    await transactionDone(snapshotTransaction);

    const currentTips = new Map(tipSnapshots);
    const verifiedTransactions = [];
    for (const group of groups) {
      const tip = currentTips.get(group.actorId)!;
      const enrollment = enrollments.get(group.actorId)!;
      if (
        !isLibraryCoreLowercaseHex64(generation.libraryId) ||
        !isLibraryCoreLowercaseHex64(generation.storageEpoch)
      ) {
        throw new Error(
          "authenticated operation checkpoint authority IDs must be lowercase SHA-256 values",
        );
      }
      const acceptedActorState = Object.freeze({
        actor_id: group.actorId,
        actor_public_key: enrollment.actorPublicKey,
        epoch: generation.header.epoch,
        epoch_id: generation.storageEpoch,
        library_id: generation.libraryId,
        next_actor_sequence: tip.acceptedSequence + 1,
        previous_actor_chain_digest: tip.acceptedChainDigest,
        previous_actor_operation_id: tip.acceptedOperationId,
      }) satisfies LibraryCoreAcceptedActorStateV1;
      const verified = await verifyLibraryCoreOperationTransactionV1(
        group.entries.map(operationEnvelopeBytes),
        acceptedActorState,
        {
          digest: libraryCoreDigest,
          verifySignature: (verification) =>
            verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
        },
      );
      for (const member of verified.members) {
        for (const tip of member.envelope.causal_frontier) {
          if (!knownCausalTips.has(causalTipIdentity(tip))) {
            throw new Error(
              `operation ${member.envelope.operation_id} names an unknown causal frontier tip`,
            );
          }
        }
        knownCausalTips.add(
          [
            member.envelope.actor_id,
            member.envelope.actor_sequence,
            member.envelope.operation_id,
            member.envelope.actor_chain_digest,
          ].join("\u0000"),
        );
      }
      verifiedTransactions.push(verified);
      const last = verified.members.at(-1)!.envelope;
      currentTips.set(group.actorId, {
        ...tip,
        acceptedChainDigest: last.actor_chain_digest,
        acceptedOperationId: last.operation_id,
        acceptedSequence: last.actor_sequence,
      });
    }

    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        CONTROL_STORE,
        OPERATIONS_STORE,
        SEGMENTS_STORE,
        ACTOR_TIPS_STORE,
        AUTHENTICATED_OPERATIONS_STORE,
        AUTHENTICATED_SEGMENTS_STORE,
        MATERIALIZED_ROWS_STORE,
        READ_STATE_STORE,
        FEED_ROWS_STORE,
      ],
      "readwrite",
    );
    const currentSelected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const currentGeneration = (await requestResult(
      transaction.objectStore(GENERATIONS_STORE).get(generation.generationId),
    )) as PortableGenerationRecord | undefined;
    if (
      currentSelected?.generationId !== generation.generationId ||
      currentSelected.selectionSequence !== generation.selectionSequence ||
      !currentGeneration ||
      currentGeneration.authenticatedThroughIngestSequence !==
        generation.authenticatedThroughIngestSequence ||
      currentGeneration.authenticatedFrontierDigest !==
        generation.authenticatedFrontierDigest ||
      currentGeneration.latestAuthenticatedSegmentDigest !==
        generation.latestAuthenticatedSegmentDigest
    ) {
      transaction.abort();
      throw new Error(
        "selected checkpoint or authenticated frontier changed during verification",
      );
    }
    for (const [actorId, snapshot] of tipSnapshots) {
      const current = (await requestResult(
        transaction
          .objectStore(ACTOR_TIPS_STORE)
          .get([generation.generationId, actorId]),
      )) as PortableActorTipRecord | undefined;
      if (
        !current ||
        current.acceptedSequence !== snapshot.acceptedSequence ||
        current.acceptedOperationId !== snapshot.acceptedOperationId ||
        current.acceptedChainDigest !== snapshot.acceptedChainDigest ||
        current.retired !== snapshot.retired
      ) {
        transaction.abort();
        throw new Error("actor tip changed during operation verification");
      }
    }

    const operations = transaction.objectStore(OPERATIONS_STORE);
    const authenticatedOperations = transaction.objectStore(
      AUTHENTICATED_OPERATIONS_STORE,
    );
    const materializedRows = transaction.objectStore(MATERIALIZED_ROWS_STORE);
    const readStates = transaction.objectStore(READ_STATE_STORE);
    const feedRows = transaction.objectStore(FEED_ROWS_STORE);
    let entryOffset = 0;
    for (const verified of verifiedTransactions) {
      for (const member of verified.members) {
        const entry = entries[entryOffset]!;
        authenticatedOperations.add({
          actorChainDigest: member.envelope.actor_chain_digest,
          actorId: member.envelope.actor_id,
          actorSequence: member.envelope.actor_sequence,
          entry,
          generationId: generation.generationId,
          ingestSequence: entry.ingest_sequence,
          operationId: entry.operation_id,
          segmentDigest: header.segment_digest,
          transactionDigest: verified.transaction_digest,
        } satisfies PortableAuthenticatedOperationRecord);
        const entityId = member.envelope.entity_id;
        const primaryKey = canonicalStringKey(entityId);
        let storedRow: PortableMaterializedRowRecord | undefined;
        for (const registryKey of PORTABLE_FEED_REGISTRY_KEYS) {
          storedRow = (await requestResult(
            materializedRows.get([
              generation.generationId,
              registryKey,
              primaryKey,
            ]),
          )) as PortableMaterializedRowRecord | undefined;
          if (storedRow) break;
        }
        if (member.envelope.operation_type === "feed_item_read_assignment") {
          const existingReadState = (await requestResult(
            readStates.get([generation.generationId, entityId]),
          )) as PortableReadStateRecord | undefined;
          const merged = FEED_ITEM_READ_AT_FIELD_ALGEBRA.merge(
            existingReadState?.readAtMs,
            member.envelope.payload.read_at_ms,
          );
          if (!merged.ok) {
            transaction.abort();
            throw new Error(merged.reason);
          }
          const incomingWins =
            !existingReadState ||
            merged.value < existingReadState.readAtMs ||
            (merged.value === existingReadState.readAtMs &&
              member.envelope.operation_id < existingReadState.operationId);
          if (incomingWins) {
            readStates.put({
              actorId: member.envelope.actor_id,
              actorSequence: member.envelope.actor_sequence,
              chainDigest: member.envelope.actor_chain_digest,
              entityId,
              generationId: generation.generationId,
              operationId: member.envelope.operation_id,
              readAtMs: merged.value,
            } satisfies PortableReadStateRecord);
            if (storedRow) {
              const currentUserState =
                typeof storedRow.row.userState === "object" &&
                storedRow.row.userState !== null &&
                !Array.isArray(storedRow.row.userState)
                  ? storedRow.row.userState
                  : {};
              const updatedRow = {
                ...storedRow,
                row: {
                  ...storedRow.row,
                  userState: {
                    ...currentUserState,
                    readAt: merged.value,
                  },
                },
              } satisfies PortableMaterializedRowRecord;
              materializedRows.put(updatedRow);
              const projected = projectPortableFeedRow(
                generation.generationId,
                updatedRow,
              );
              if (projected) feedRows.put(projected);
            }
          }
        } else if (member.envelope.operation_type === "feed_item_remove") {
          if (storedRow) {
            const projected = projectPortableFeedRow(
              generation.generationId,
              storedRow,
            );
            materializedRows.delete([
              generation.generationId,
              storedRow.registryKey,
              storedRow.primaryKey,
            ]);
            if (projected) {
              feedRows.delete([generation.generationId, projected.orderKey]);
            }
          }
        } else if (storedRow) {
          const updatedRow = assignedPortableFeedRow(
            storedRow,
            member.envelope.operation_type === "feed_item_saved_assignment"
              ? "saved"
              : member.envelope.operation_type === "feed_item_archive_assignment"
                ? "archived"
                : "liked",
            member.envelope.payload.assigned,
            member.envelope.payload.assigned_at_ms,
          );
          materializedRows.put(updatedRow);
          const projected = projectPortableFeedRow(
            generation.generationId,
            updatedRow,
          );
          if (projected) feedRows.put(projected);
        }
        entryOffset += 1;
      }
    }
    for (const [actorId, tip] of currentTips) {
      transaction.objectStore(ACTOR_TIPS_STORE).put({
        ...tip,
        actorId,
      } satisfies PortableActorTipRecord);
    }
    const transactionDigests = Object.freeze(
      verifiedTransactions.map((verified) => verified.transaction_digest),
    );
    transaction.objectStore(AUTHENTICATED_SEGMENTS_STORE).add({
      firstIngestSequence: header.first_ingest_sequence,
      generationId: generation.generationId,
      header,
      lastIngestSequence: header.last_ingest_sequence,
      objectKey: reference.descriptor.objectKey,
      storedByteLength: reference.descriptor.byteLength,
      storedContentDigest: reference.descriptor.contentDigest,
      transactionDigests,
      transportObjectId: reference.transportObjectId,
    } satisfies PortableAuthenticatedSegmentRecord);
    if (!rawExisting) {
      for (const entry of entries) {
        operations.add({
          entry,
          generationId: generation.generationId,
          ingestSequence: entry.ingest_sequence,
          operationId: entry.operation_id,
          segmentDigest: header.segment_digest,
        } satisfies PortableOperationRecord);
      }
      transaction.objectStore(SEGMENTS_STORE).add({
        firstIngestSequence: header.first_ingest_sequence,
        generationId: generation.generationId,
        header,
        lastIngestSequence: header.last_ingest_sequence,
        objectKey: reference.descriptor.objectKey,
        storedByteLength: reference.descriptor.byteLength,
        storedContentDigest: reference.descriptor.contentDigest,
        transportObjectId: reference.transportObjectId,
      } satisfies PortableSegmentRecord);
    }
    transaction.objectStore(GENERATIONS_STORE).put({
      ...currentGeneration,
      authenticatedFrontierDigest: header.result_frontier_digest,
      authenticatedThroughIngestSequence: header.last_ingest_sequence,
      frontierDigest:
        currentGeneration.importedThroughIngestSequence >
        header.last_ingest_sequence
          ? currentGeneration.frontierDigest
          : header.result_frontier_digest,
      importedThroughIngestSequence: Math.max(
        currentGeneration.importedThroughIngestSequence,
        header.last_ingest_sequence,
      ),
      latestAuthenticatedSegmentDigest: header.segment_digest,
      latestOperationSegmentDigest:
        currentGeneration.importedThroughIngestSequence >
        header.last_ingest_sequence
          ? currentGeneration.latestOperationSegmentDigest
          : header.segment_digest,
    } satisfies PortableGenerationRecord);
    await transactionDone(transaction);
    this.#feedSessions.clear();
    return this.#segmentReceipt(header);
  }

  async enqueueIntentTransaction(
    transactionValue: LibraryCoreFinalizedTransactionV1,
  ): Promise<PwaLibraryCoreIntentEnqueueReceiptV1> {
    this.#requireAvailable();
    if (!isLibraryCoreFinalizedTransactionV1(transactionValue)) {
      throw new TypeError(
        "intent transaction must come from the closed finalization contract",
      );
    }
    if (
      transactionValue.members.length === 0 ||
      transactionValue.members.length >
        LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT ||
      transactionValue.canonical_envelope_bytes >
        LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT
    ) {
      throw new RangeError(
        "intent transaction exceeds the immutable segment bounds",
      );
    }

    const transactionId = transactionValue.transaction_body.transaction_id;
    const transactionDigest = transactionValue.transaction_digest;
    const entries = Object.freeze(
      transactionValue.members.map((member) =>
        snapshotIntentEntry({
          canonical_envelope: member.envelope as unknown as Readonly<
            Record<string, LibraryCoreCanonicalValue>
          >,
          intent_sequence: member.envelope.actor_sequence,
          kind: "intent_segment_entry",
          operation_id: member.envelope.operation_id,
        }),
      ),
    );
    const firstEnvelope = entries[0]!.canonical_envelope;
    const lastEnvelope = entries.at(-1)!.canonical_envelope;
    const libraryId =
      firstEnvelope.library_id as LibraryCoreOperationInstanceId;
    const epochId = firstEnvelope.epoch_id as LibraryCoreOperationInstanceId;
    const actorId = firstEnvelope.actor_id as LibraryCoreOperationInstanceId;
    const schemaVersion = firstEnvelope.schema_version as number;
    for (let index = 0; index < entries.length; index += 1) {
      const envelope = entries[index]!.canonical_envelope;
      if (
        envelope.transaction_id !== transactionId ||
        envelope.transaction_digest !== transactionDigest ||
        envelope.transaction_member_count !== entries.length ||
        envelope.transaction_member_index !== index ||
        envelope.actor_sequence !==
          (firstEnvelope.actor_sequence as number) + index ||
        (index > 0 &&
          (envelope.previous_actor_operation_id !==
            entries[index - 1]!.operation_id ||
            envelope.previous_actor_chain_digest !==
              entries[index - 1]!.canonical_envelope.actor_chain_digest))
      ) {
        throw new TypeError(
          "finalized intent transaction members are split or reordered",
        );
      }
    }
    const transactionRecord = Object.freeze({
      actorId,
      canonicalEnvelopeBytes: transactionValue.canonical_envelope_bytes,
      epochId,
      firstIntentSequence: firstEnvelope.actor_sequence as number,
      lastIntentSequence: lastEnvelope.actor_sequence as number,
      libraryId,
      operationCount: entries.length,
      operationIds: Object.freeze(entries.map((entry) => entry.operation_id)),
      transactionDigest,
      transactionId,
    }) satisfies PortableIntentTransactionRecord;
    if (!Number.isSafeInteger(transactionRecord.lastIntentSequence + 1)) {
      throw new RangeError("intent actor sequence is exhausted");
    }
    const operationRecords = Object.freeze(
      entries.map(
        (entry, index) =>
          Object.freeze({
            actorId,
            entry,
            envelopeDigest: transactionValue.members[index]!.envelope_digest,
            epochId,
            intentSequence: entry.intent_sequence,
            libraryId,
            publishedStoredDigest: null,
            transactionDigest,
            transactionId,
          }) satisfies PortableIntentOperationRecord,
      ),
    );

    const database = await this.#database();
    const transaction = database.transaction(
      [INTENT_ACTORS_STORE, INTENT_OPERATIONS_STORE, INTENT_TRANSACTIONS_STORE],
      "readwrite",
    );
    const actors = transaction.objectStore(INTENT_ACTORS_STORE);
    const operations = transaction.objectStore(INTENT_OPERATIONS_STORE);
    const transactions = transaction.objectStore(INTENT_TRANSACTIONS_STORE);
    const actorRequest = actors.get([libraryId, epochId, actorId]);
    const existingTransactionRequest = transactions
      .index("by_actor_transaction_id")
      .get([libraryId, epochId, actorId, transactionId]);
    const actor = (await requestResult(actorRequest)) as
      PortableIntentActorRecord | undefined;
    const existingTransaction = (await requestResult(
      existingTransactionRequest,
    )) as PortableIntentTransactionRecord | undefined;

    if (existingTransaction) {
      if (!sameIntentTransaction(existingTransaction, transactionRecord)) {
        transaction.abort();
        throw new Error(
          "intent transaction identity already exists with different bytes",
        );
      }
      for (const operationRecord of operationRecords) {
        const existingOperation = (await requestResult(
          operations.get([
            libraryId,
            epochId,
            actorId,
            operationRecord.intentSequence,
          ]),
        )) as PortableIntentOperationRecord | undefined;
        if (
          !existingOperation ||
          !sameIntentOperation(existingOperation, operationRecord)
        ) {
          transaction.abort();
          throw new Error(
            "intent transaction replay does not match its durable operations",
          );
        }
      }
      await transactionDone(transaction);
      return Object.freeze({
        firstIntentSequence: transactionRecord.firstIntentSequence,
        lastIntentSequence: transactionRecord.lastIntentSequence,
        operationCount: transactionRecord.operationCount,
        status: "already_enqueued",
        transactionId,
      });
    }

    if (
      actor &&
      (actor.epochId !== epochId || actor.schemaVersion !== schemaVersion)
    ) {
      transaction.abort();
      throw new Error(
        "intent transaction crosses the durable actor epoch or schema",
      );
    }
    const expectedSequence = actor?.nextIntentSequence ?? 1;
    const expectedPreviousOperation = actor?.latestOperationId ?? null;
    const expectedPreviousChain =
      actor?.latestActorChainDigest ??
      (firstEnvelope.previous_actor_chain_digest as LibraryCoreLowercaseHex64);
    if (
      transactionRecord.firstIntentSequence !== expectedSequence ||
      firstEnvelope.previous_actor_operation_id !== expectedPreviousOperation ||
      firstEnvelope.previous_actor_chain_digest !== expectedPreviousChain
    ) {
      transaction.abort();
      throw new Error(
        "intent transaction does not extend the durable actor chain",
      );
    }
    for (const operationRecord of operationRecords) {
      operations.add(operationRecord);
    }
    transactions.add(transactionRecord);
    actors.put({
      actorId,
      epochId,
      latestActorChainDigest:
        lastEnvelope.actor_chain_digest as LibraryCoreLowercaseHex64,
      latestOperationId:
        lastEnvelope.operation_id as LibraryCoreOperationInstanceId,
      latestPublishedSegment: actor?.latestPublishedSegment ?? null,
      latestPublishedStoredDigest: actor?.latestPublishedStoredDigest ?? null,
      libraryId,
      nextIntentSequence: transactionRecord.lastIntentSequence + 1,
      publishedThroughIntentSequence:
        actor?.publishedThroughIntentSequence ?? 0,
      schemaVersion,
    } satisfies PortableIntentActorRecord);
    await transactionDone(transaction);
    return Object.freeze({
      firstIntentSequence: transactionRecord.firstIntentSequence,
      lastIntentSequence: transactionRecord.lastIntentSequence,
      operationCount: transactionRecord.operationCount,
      status: "enqueued",
      transactionId,
    });
  }

  /**
   * Sign and durably enqueue a bounded read-state intent under this PWA's
   * enrolled actor identity. The actor's nonextractable private key never
   * leaves IndexedDB.
   */
  async enqueueReadAssignments(input: {
    readonly entityIds: readonly string[];
    readonly readAtMs: number;
  }): Promise<PwaLibraryCoreIntentEnqueueReceiptV1 | null> {
    this.#requireAvailable();
    if (input.entityIds.length === 0) return null;
    if (input.entityIds.length > LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT) {
      throw new RangeError("read assignment intent exceeds the segment bound");
    }
    if (!Number.isSafeInteger(input.readAtMs) || input.readAtMs < 0) {
      throw new TypeError("read assignment time must be a nonnegative integer");
    }
    const entityIds = Object.freeze([...new Set(input.entityIds)]);
    if (entityIds.length === 0) return null;

    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        CONTROL_STORE,
        ACTOR_TIPS_STORE,
        ACTOR_ENROLLMENTS_STORE,
        INTENT_ACTORS_STORE,
        PWA_ACTOR_IDENTITIES_STORE,
      ],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    const identity = generation
      ? ((await requestResult(
          transaction
            .objectStore(PWA_ACTOR_IDENTITIES_STORE)
            .get(generation.libraryId),
        )) as PortablePwaActorIdentityRecord | undefined)
      : undefined;
    const actorTip =
      selected && identity
        ? ((await requestResult(
            transaction
              .objectStore(ACTOR_TIPS_STORE)
              .get([selected.generationId, identity.actorId]),
          )) as PortableActorTipRecord | undefined)
        : undefined;
    const enrollment =
      selected && identity
        ? ((await requestResult(
            transaction
              .objectStore(ACTOR_ENROLLMENTS_STORE)
              .get([selected.generationId, identity.actorId]),
          )) as PortableActorEnrollmentRecord | undefined)
        : undefined;
    const activeEpochId =
      generation?.header?.anchor_kind === "accepted_authority" &&
      generation.header.accepted_authority !== null
        ? generation.header.accepted_authority.epoch_id
        : null;
    const intentActor =
      generation && identity && activeEpochId
        ? ((await requestResult(
            transaction
              .objectStore(INTENT_ACTORS_STORE)
              .get([generation.libraryId, activeEpochId, identity.actorId]),
          )) as PortableIntentActorRecord | undefined)
        : undefined;
    await transactionDone(transaction);

    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header?.anchor_kind !== "accepted_authority" ||
      generation.header.accepted_authority === null ||
      !identity ||
      !actorTip ||
      actorTip.retired ||
      !enrollment ||
      enrollment.certificateDigest !== actorTip.enrollmentCertificateDigest
    ) {
      throw new Error("PWA read intent requires an active enrolled actor");
    }

    const authority = generation.header.accepted_authority;
    const firstSequence =
      intentActor?.nextIntentSequence ?? actorTip.acceptedSequence + 1;
    const previousOperationId =
      intentActor?.latestOperationId ?? actorTip.acceptedOperationId;
    const previousChainDigest =
      intentActor?.latestActorChainDigest ?? actorTip.acceptedChainDigest;
    const transactionId =
      `pwa-read:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = entityIds.map((entityId, index) =>
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: authority.library_id,
          epoch: authority.epoch,
          epoch_id: authority.epoch_id,
          actor_id: identity.actorId,
          actor_sequence: firstSequence + index,
          previous_actor_operation_id:
            index === 0 ? previousOperationId : `${transactionId}:${index - 1}`,
          causal_frontier: authority.observed_frontier,
          hlc_wall_ms: input.readAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: entityIds.length,
          entity_id: entityId,
          payload: { read_at_ms: input.readAtMs },
          created_at_ms: input.readAtMs,
        } satisfies FeedItemReadAssignmentTransactionMemberInputV1,
        { digest: libraryCoreDigest },
      ),
    );
    const assembled = assembleLibraryCoreTransactionV1(
      members,
      previousChainDigest,
      { digest: libraryCoreDigest },
    );
    const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
      digest: libraryCoreDigest,
      signOperation: async (message) =>
        lowerHex(
          await this.#subtle.sign(
            { name: "Ed25519" },
            identity.actorPrivateKey,
            exactArrayBuffer(message),
          ),
        ) as LibraryCoreEd25519SignatureHex,
    });
    const receipt = await this.enqueueIntentTransaction(finalized);
    await this.applySelectedReadAssignments({
      entityIds,
      readAtMs: input.readAtMs,
    });
    return receipt;
  }

  private async applySelectedReadAssignments(input: {
    readonly entityIds: readonly string[];
    readonly readAtMs: number;
  }): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [CONTROL_STORE, MATERIALIZED_ROWS_STORE, FEED_ROWS_STORE],
      "readwrite",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    if (!selected) {
      transaction.abort();
      throw new Error("PWA read intent has no selected Library generation");
    }
    const materializedRows = transaction.objectStore(MATERIALIZED_ROWS_STORE);
    const feedRows = transaction.objectStore(FEED_ROWS_STORE);
    for (const entityId of input.entityIds) {
      let stored: PortableMaterializedRowRecord | undefined;
      for (const registryKey of PORTABLE_FEED_REGISTRY_KEYS) {
        stored = (await requestResult(
          materializedRows.get([
            selected.generationId,
            registryKey,
            canonicalStringKey(entityId),
          ]),
        )) as PortableMaterializedRowRecord | undefined;
        if (stored) break;
      }
      if (!stored) {
        transaction.abort();
        throw new Error("PWA read intent targets an unavailable FeedItem");
      }
      const currentUserState: Readonly<
        Record<string, LibraryCoreCanonicalValue>
      > =
        typeof stored.row.userState === "object" &&
          stored.row.userState !== null &&
          !Array.isArray(stored.row.userState)
          ? stored.row.userState as Readonly<
              Record<string, LibraryCoreCanonicalValue>
            >
          : {};
      const existingReadAt = currentUserState.readAt;
      if (
        typeof existingReadAt === "number" &&
        Number.isSafeInteger(existingReadAt) &&
        existingReadAt <= input.readAtMs
      ) {
        continue;
      }
      const updated = {
        ...stored,
        row: {
          ...stored.row,
          userState: {
            ...currentUserState,
            readAt: input.readAtMs,
          },
        },
      } satisfies PortableMaterializedRowRecord;
      materializedRows.put(updated);
      const projected = projectPortableFeedRow(
        selected.generationId,
        updated,
      );
      if (projected) feedRows.put(projected);
    }
    await transactionDone(transaction);
  }

  /** Sign and durably enqueue one idempotent FeedItem user-state assignment. */
  async enqueueUserStateAssignment(input: {
    readonly entityId: string;
    readonly field: FeedItemUserStateAssignmentFieldV1;
    readonly assigned: boolean;
    readonly assignedAtMs: number;
  }): Promise<PwaLibraryCoreIntentEnqueueReceiptV1> {
    return this.enqueueUserStateAssignments([input]);
  }

  /** Sign and enqueue one bounded, atomic batch of user-state assignments. */
  async enqueueUserStateAssignments(
    assignments: readonly {
      readonly entityId: string;
      readonly field: FeedItemUserStateAssignmentFieldV1;
      readonly assigned: boolean;
      readonly assignedAtMs: number;
    }[],
  ): Promise<PwaLibraryCoreIntentEnqueueReceiptV1> {
    this.#requireAvailable();
    if (
      assignments.length === 0 ||
      assignments.length > LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT
    ) {
      throw new RangeError("assignment batch exceeds the intent segment bound");
    }
    const identities = new Set<string>();
    for (const assignment of assignments) {
      if (!assignment.entityId) {
        throw new TypeError("assignment entity ID is required");
      }
      if (
        !Number.isSafeInteger(assignment.assignedAtMs) ||
        assignment.assignedAtMs < 0
      ) {
        throw new TypeError("assignment time must be a nonnegative integer");
      }
      const identity = `${assignment.field}\u0000${assignment.entityId}`;
      if (identities.has(identity)) {
        throw new TypeError("assignment batch contains a duplicate field and entity");
      }
      identities.add(identity);
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        CONTROL_STORE,
        ACTOR_TIPS_STORE,
        ACTOR_ENROLLMENTS_STORE,
        INTENT_ACTORS_STORE,
        PWA_ACTOR_IDENTITIES_STORE,
      ],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    const identity = generation
      ? ((await requestResult(
          transaction
            .objectStore(PWA_ACTOR_IDENTITIES_STORE)
            .get(generation.libraryId),
        )) as PortablePwaActorIdentityRecord | undefined)
      : undefined;
    const actorTip =
      selected && identity
        ? ((await requestResult(
            transaction
              .objectStore(ACTOR_TIPS_STORE)
              .get([selected.generationId, identity.actorId]),
          )) as PortableActorTipRecord | undefined)
        : undefined;
    const enrollment =
      selected && identity
        ? ((await requestResult(
            transaction
              .objectStore(ACTOR_ENROLLMENTS_STORE)
              .get([selected.generationId, identity.actorId]),
          )) as PortableActorEnrollmentRecord | undefined)
        : undefined;
    const activeEpochId =
      generation?.header?.anchor_kind === "accepted_authority" &&
      generation.header.accepted_authority !== null
        ? generation.header.accepted_authority.epoch_id
        : null;
    const intentActor =
      generation && identity && activeEpochId
        ? ((await requestResult(
            transaction
              .objectStore(INTENT_ACTORS_STORE)
              .get([generation.libraryId, activeEpochId, identity.actorId]),
          )) as PortableIntentActorRecord | undefined)
        : undefined;
    await transactionDone(transaction);

    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header?.anchor_kind !== "accepted_authority" ||
      generation.header.accepted_authority === null ||
      !identity ||
      !actorTip ||
      actorTip.retired ||
      !enrollment ||
      enrollment.certificateDigest !== actorTip.enrollmentCertificateDigest
    ) {
      throw new Error("PWA assignment intent requires an active enrolled actor");
    }

    const authority = generation.header.accepted_authority;
    const firstActorSequence =
      intentActor?.nextIntentSequence ?? actorTip.acceptedSequence + 1;
    if (
      !Number.isSafeInteger(firstActorSequence + assignments.length - 1)
    ) {
      throw new RangeError("intent actor sequence is exhausted");
    }
    const previousOperationId =
      intentActor?.latestOperationId ?? actorTip.acceptedOperationId;
    const previousChainDigest =
      intentActor?.latestActorChainDigest ?? actorTip.acceptedChainDigest;
    const transactionId =
      `pwa-assignment:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const members = assignments.map((assignment, index) => {
      const schema =
        assignment.field === "saved"
          ? FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
          : assignment.field === "archived"
            ? FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
            : FEED_ITEM_LIKE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA;
      return schema.construct(
        {
          operation_id: `${transactionId}:${index}`,
          library_id: authority.library_id,
          epoch: authority.epoch,
          epoch_id: authority.epoch_id,
          actor_id: identity.actorId,
          actor_sequence: firstActorSequence + index,
          previous_actor_operation_id:
            index === 0 ? previousOperationId : `${transactionId}:${index - 1}`,
          causal_frontier: authority.observed_frontier,
          hlc_wall_ms: assignment.assignedAtMs,
          hlc_counter: index,
          transaction_id: transactionId,
          transaction_member_index: index,
          transaction_member_count: assignments.length,
          entity_id: assignment.entityId,
          payload: {
            assigned: assignment.assigned,
            assigned_at_ms: assignment.assignedAtMs,
          },
          created_at_ms: assignment.assignedAtMs,
        } satisfies FeedItemUserStateAssignmentTransactionMemberInputV1,
        { digest: libraryCoreDigest },
      );
    });
    const assembled = assembleLibraryCoreTransactionV1(
      members,
      previousChainDigest,
      { digest: libraryCoreDigest },
    );
    const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
      digest: libraryCoreDigest,
      signOperation: async (message) =>
        lowerHex(
          await this.#subtle.sign(
            { name: "Ed25519" },
            identity.actorPrivateKey,
            exactArrayBuffer(message),
          ),
        ) as LibraryCoreEd25519SignatureHex,
    });
    const receipt = await this.enqueueIntentTransaction(finalized);
    await this.applySelectedUserStateAssignments(assignments);
    return receipt;
  }

  private async applySelectedUserStateAssignments(
    assignments: readonly {
      readonly entityId: string;
      readonly field: FeedItemUserStateAssignmentFieldV1;
      readonly assigned: boolean;
      readonly assignedAtMs: number;
    }[],
  ): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [CONTROL_STORE, MATERIALIZED_ROWS_STORE, FEED_ROWS_STORE],
      "readwrite",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    if (!selected) {
      transaction.abort();
      throw new Error("PWA assignment intent has no selected Library generation");
    }
    const materializedRows = transaction.objectStore(MATERIALIZED_ROWS_STORE);
    const feedRows = transaction.objectStore(FEED_ROWS_STORE);
    for (const input of assignments) {
      let stored: PortableMaterializedRowRecord | undefined;
      for (const registryKey of PORTABLE_FEED_REGISTRY_KEYS) {
        stored = (await requestResult(
          materializedRows.get([
            selected.generationId,
            registryKey,
            canonicalStringKey(input.entityId),
          ]),
        )) as PortableMaterializedRowRecord | undefined;
        if (stored) break;
      }
      if (!stored) {
        transaction.abort();
        throw new Error("PWA assignment intent targets an unavailable FeedItem");
      }
      const updated = assignedPortableFeedRow(
        stored,
        input.field,
        input.assigned,
        input.assignedAtMs,
      );
      materializedRows.put(updated);
      const projected = projectPortableFeedRow(selected.generationId, updated);
      if (projected) feedRows.put(projected);
    }
    await transactionDone(transaction);
    this.#feedSessions.clear();
  }

  /** Sign, enqueue, and optimistically apply one FeedItem tombstone intent. */
  async enqueueFeedItemRemove(input: {
    readonly entityId: string;
    readonly removedAtMs: number;
  }): Promise<PwaLibraryCoreIntentEnqueueReceiptV1> {
    this.#requireAvailable();
    if (!input.entityId) throw new TypeError("remove entity ID is required");
    if (!Number.isSafeInteger(input.removedAtMs) || input.removedAtMs < 0) {
      throw new TypeError("remove time must be a nonnegative integer");
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        CONTROL_STORE,
        ACTOR_TIPS_STORE,
        ACTOR_ENROLLMENTS_STORE,
        INTENT_ACTORS_STORE,
        PWA_ACTOR_IDENTITIES_STORE,
      ],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    const identity = generation
      ? ((await requestResult(
          transaction
            .objectStore(PWA_ACTOR_IDENTITIES_STORE)
            .get(generation.libraryId),
        )) as PortablePwaActorIdentityRecord | undefined)
      : undefined;
    const actorTip =
      selected && identity
        ? ((await requestResult(
            transaction
              .objectStore(ACTOR_TIPS_STORE)
              .get([selected.generationId, identity.actorId]),
          )) as PortableActorTipRecord | undefined)
        : undefined;
    const enrollment =
      selected && identity
        ? ((await requestResult(
            transaction
              .objectStore(ACTOR_ENROLLMENTS_STORE)
              .get([selected.generationId, identity.actorId]),
          )) as PortableActorEnrollmentRecord | undefined)
        : undefined;
    const activeEpochId =
      generation?.header?.anchor_kind === "accepted_authority" &&
      generation.header.accepted_authority !== null
        ? generation.header.accepted_authority.epoch_id
        : null;
    const intentActor =
      generation && identity && activeEpochId
        ? ((await requestResult(
            transaction
              .objectStore(INTENT_ACTORS_STORE)
              .get([generation.libraryId, activeEpochId, identity.actorId]),
          )) as PortableIntentActorRecord | undefined)
        : undefined;
    await transactionDone(transaction);
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header?.anchor_kind !== "accepted_authority" ||
      generation.header.accepted_authority === null ||
      !identity ||
      !actorTip ||
      actorTip.retired ||
      !enrollment ||
      enrollment.certificateDigest !== actorTip.enrollmentCertificateDigest
    ) {
      throw new Error("PWA remove intent requires an active enrolled actor");
    }
    const authority = generation.header.accepted_authority;
    const actorSequence =
      intentActor?.nextIntentSequence ?? actorTip.acceptedSequence + 1;
    const previousOperationId =
      intentActor?.latestOperationId ?? actorTip.acceptedOperationId;
    const previousChainDigest =
      intentActor?.latestActorChainDigest ?? actorTip.acceptedChainDigest;
    const transactionId =
      `pwa-remove:${crypto.randomUUID()}` as LibraryCoreOperationInstanceId;
    const member = FEED_ITEM_REMOVE_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        operation_id: `${transactionId}:0`,
        library_id: authority.library_id,
        epoch: authority.epoch,
        epoch_id: authority.epoch_id,
        actor_id: identity.actorId,
        actor_sequence: actorSequence,
        previous_actor_operation_id: previousOperationId,
        causal_frontier: authority.observed_frontier,
        hlc_wall_ms: input.removedAtMs,
        hlc_counter: 0,
        transaction_id: transactionId,
        transaction_member_index: 0,
        transaction_member_count: 1,
        entity_id: input.entityId,
        payload: { removed_at_ms: input.removedAtMs },
        created_at_ms: input.removedAtMs,
      } satisfies FeedItemRemoveTransactionMemberInputV1,
      { digest: libraryCoreDigest },
    );
    const assembled = assembleLibraryCoreTransactionV1(
      [member],
      previousChainDigest,
      { digest: libraryCoreDigest },
    );
    const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
      digest: libraryCoreDigest,
      signOperation: async (message) =>
        lowerHex(
          await this.#subtle.sign(
            { name: "Ed25519" },
            identity.actorPrivateKey,
            exactArrayBuffer(message),
          ),
        ) as LibraryCoreEd25519SignatureHex,
    });
    const receipt = await this.enqueueIntentTransaction(finalized);
    await this.applySelectedFeedItemRemove(input.entityId);
    return receipt;
  }

  private async applySelectedFeedItemRemove(entityId: string): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [CONTROL_STORE, MATERIALIZED_ROWS_STORE, FEED_ROWS_STORE],
      "readwrite",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    if (!selected) {
      transaction.abort();
      throw new Error("PWA remove intent has no selected Library generation");
    }
    const materializedRows = transaction.objectStore(MATERIALIZED_ROWS_STORE);
    const feedRows = transaction.objectStore(FEED_ROWS_STORE);
    let removed = false;
    for (const registryKey of PORTABLE_FEED_REGISTRY_KEYS) {
      const key = [
        selected.generationId,
        registryKey,
        canonicalStringKey(entityId),
      ];
      const stored = (await requestResult(materializedRows.get(key))) as
        PortableMaterializedRowRecord | undefined;
      if (!stored) continue;
      const projected = projectPortableFeedRow(selected.generationId, stored);
      materializedRows.delete(key);
      if (projected) {
        feedRows.delete([selected.generationId, projected.orderKey]);
      }
      removed = true;
    }
    if (!removed) {
      transaction.abort();
      throw new Error("PWA remove intent targets an unavailable FeedItem");
    }
    await transactionDone(transaction);
    this.#feedSessions.clear();
  }

  async readUnpublishedIntentSegmentCandidate(
    input: ReadPwaLibraryCoreIntentCandidateInput,
  ): Promise<PwaLibraryCoreIntentSegmentCandidateV1 | null> {
    this.#requireAvailable();
    if (
      !Number.isSafeInteger(input.maximumOperations ?? 1) ||
      (input.maximumOperations ?? 1) < 1 ||
      (input.maximumOperations ?? LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT) >
        LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT
    ) {
      throw new TypeError(
        "intent candidate maximumOperations must be within the segment bound",
      );
    }
    if (
      !Number.isSafeInteger(input.maximumCanonicalEnvelopeBytes ?? 1) ||
      (input.maximumCanonicalEnvelopeBytes ?? 1) < 1 ||
      (input.maximumCanonicalEnvelopeBytes ??
        LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT) >
        LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT
    ) {
      throw new TypeError(
        "intent candidate maximumCanonicalEnvelopeBytes must be within the segment bound",
      );
    }
    const maximumOperations =
      input.maximumOperations ?? LIBRARY_CORE_INTENT_SEGMENT_ENTRY_LIMIT;
    const maximumCanonicalBytes =
      input.maximumCanonicalEnvelopeBytes ??
      LIBRARY_CORE_INTENT_SEGMENT_CANONICAL_BYTE_LIMIT;
    const database = await this.#database();
    const transaction = database.transaction(
      [INTENT_ACTORS_STORE, INTENT_OPERATIONS_STORE, INTENT_TRANSACTIONS_STORE],
      "readonly",
    );
    const actor = (await requestResult(
      transaction
        .objectStore(INTENT_ACTORS_STORE)
        .get([input.libraryId, input.epochId, input.actorId]),
    )) as PortableIntentActorRecord | undefined;
    if (!actor) {
      await transactionDone(transaction);
      return null;
    }
    if (actor.epochId !== input.epochId) {
      transaction.abort();
      throw new Error("intent candidate crosses the durable actor epoch");
    }
    const firstIntentSequence = actor.publishedThroughIntentSequence + 1;
    if (firstIntentSequence === actor.nextIntentSequence) {
      await transactionDone(transaction);
      return null;
    }
    const transactionRange = this.#keyRange.bound(
      [input.libraryId, input.epochId, input.actorId, firstIntentSequence],
      [input.libraryId, input.epochId, input.actorId, Number.MAX_SAFE_INTEGER],
    );
    const queuedTransactions = await readBoundedIntentTransactions(
      transaction
        .objectStore(INTENT_TRANSACTIONS_STORE)
        .openCursor(transactionRange),
      maximumOperations,
      maximumCanonicalBytes,
    );
    if (
      queuedTransactions.length === 0 ||
      queuedTransactions[0]!.firstIntentSequence !== firstIntentSequence
    ) {
      transaction.abort();
      throw new Error("durable intent transaction sequence has a gap");
    }
    for (let index = 1; index < queuedTransactions.length; index += 1) {
      if (
        queuedTransactions[index]!.firstIntentSequence !==
        queuedTransactions[index - 1]!.lastIntentSequence + 1
      ) {
        transaction.abort();
        throw new Error("durable intent transactions are not contiguous");
      }
    }
    const lastIntentSequence = queuedTransactions.at(-1)!.lastIntentSequence;
    const operationRange = this.#keyRange.bound(
      [input.libraryId, input.epochId, input.actorId, firstIntentSequence],
      [input.libraryId, input.epochId, input.actorId, lastIntentSequence],
    );
    const operationRecords = (await requestResult(
      transaction.objectStore(INTENT_OPERATIONS_STORE).getAll(operationRange),
    )) as PortableIntentOperationRecord[];
    await transactionDone(transaction);
    const expectedOperationCount = queuedTransactions.reduce(
      (count, queued) => count + queued.operationCount,
      0,
    );
    if (
      operationRecords.length !== expectedOperationCount ||
      operationRecords.some(
        (operation, index) =>
          operation.intentSequence !== firstIntentSequence + index ||
          operation.publishedStoredDigest !== null,
      )
    ) {
      throw new Error(
        "durable intent operations do not match the unpublished transaction range",
      );
    }
    const entries = Object.freeze(
      operationRecords.map((operation) => snapshotIntentEntry(operation.entry)),
    );
    const body = parseLibraryCoreIntentSegmentBodyV1({
      actor_id: actor.actorId,
      canonical_envelope_bytes: queuedTransactions.reduce(
        (total, queued) => total + queued.canonicalEnvelopeBytes,
        0,
      ),
      entries,
      epoch_id: actor.epochId,
      first_intent_sequence: firstIntentSequence,
      format: "freed_intent_segment_v1",
      kind: "intent_segment_body",
      last_intent_sequence: lastIntentSequence,
      library_id: actor.libraryId,
      operation_count: entries.length,
      previous_segment_digest: actor.latestPublishedStoredDigest,
      protocol: "intent_segments_v1",
      protocol_version: 1,
      schema_version: actor.schemaVersion,
    });
    const expectedHead = intentActorHead(actor);
    return Object.freeze({
      body,
      expectedHead,
      expectedHeadDigest: intentHeadDigest(expectedHead),
      transactionCount: queuedTransactions.length,
    });
  }

  async readPendingIntentActors(input: {
    readonly epochId: LibraryCoreOperationInstanceId;
    readonly libraryId: LibraryCoreOperationInstanceId;
    readonly limit?: number;
  }): Promise<readonly PwaLibraryCorePendingIntentActorV1[]> {
    this.#requireAvailable();
    const limit = input.limit ?? 16;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
      throw new TypeError(
        "pending intent actor limit must be between 1 and 64",
      );
    }
    const database = await this.#database();
    const transaction = database.transaction(INTENT_ACTORS_STORE, "readonly");
    const records = (await requestResult(
      transaction
        .objectStore(INTENT_ACTORS_STORE)
        .getAll(
          this.#keyRange.bound(
            [input.libraryId, input.epochId],
            [input.libraryId, input.epochId, []],
          ),
          limit + 1,
        ),
    )) as PortableIntentActorRecord[];
    await transactionDone(transaction);
    const pending = records
      .filter(
        (actor) =>
          actor.publishedThroughIntentSequence < actor.nextIntentSequence - 1,
      )
      .sort((left, right) =>
        left.actorId < right.actorId
          ? -1
          : left.actorId > right.actorId
            ? 1
            : 0,
      );
    if (records.length > limit || pending.length > limit) {
      throw new Error("pending intent actor count exceeds the runtime bound");
    }
    return Object.freeze(
      pending.map((actor) =>
        Object.freeze({
          actorId: actor.actorId,
          epochId: actor.epochId,
          libraryId: actor.libraryId,
        }),
      ),
    );
  }

  async readIntentActors(input: {
    readonly epochId: LibraryCoreOperationInstanceId;
    readonly libraryId: LibraryCoreOperationInstanceId;
    readonly limit?: number;
  }): Promise<readonly PwaLibraryCorePendingIntentActorV1[]> {
    this.#requireAvailable();
    const limit = input.limit ?? 16;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
      throw new TypeError("intent actor limit must be between 1 and 64");
    }
    const database = await this.#database();
    const transaction = database.transaction(INTENT_ACTORS_STORE, "readonly");
    const records = (await requestResult(
      transaction
        .objectStore(INTENT_ACTORS_STORE)
        .getAll(
          this.#keyRange.bound(
            [input.libraryId, input.epochId],
            [input.libraryId, input.epochId, []],
          ),
          limit + 1,
        ),
    )) as PortableIntentActorRecord[];
    await transactionDone(transaction);
    if (records.length > limit) {
      throw new Error("intent actor count exceeds the runtime bound");
    }
    return Object.freeze(
      records
        .sort((left, right) => left.actorId.localeCompare(right.actorId))
        .map((actor) =>
          Object.freeze({
            actorId: actor.actorId,
            epochId: actor.epochId,
            libraryId: actor.libraryId,
          }),
        ),
    );
  }

  async readResultImportCursor(input: {
    readonly actorId: LibraryCoreOperationInstanceId;
    readonly epochId: LibraryCoreOperationInstanceId;
    readonly libraryId: LibraryCoreOperationInstanceId;
  }): Promise<
    Readonly<{
      latestSegmentDigest: LibraryCoreLowercaseHex64 | null;
      nextResultSequence: number;
    }>
  > {
    this.#requireAvailable();
    const database = await this.#database();
    const transaction = database.transaction(RESULT_ACTORS_STORE, "readonly");
    const actor = (await requestResult(
      transaction
        .objectStore(RESULT_ACTORS_STORE)
        .get([input.libraryId, input.epochId, input.actorId]),
    )) as PortableResultActorRecord | undefined;
    await transactionDone(transaction);
    return Object.freeze({
      latestSegmentDigest: actor?.latestSegmentDigest ?? null,
      nextResultSequence: actor?.nextResultSequence ?? 1,
    });
  }

  async recordIntentSegmentPublication(
    input: RecordPwaLibraryCoreIntentPublicationInput,
  ): Promise<PwaLibraryCoreIntentPublicationReceiptV1> {
    this.#requireAvailable();
    const header = parseLibraryCoreIntentSegmentHeaderV1(input.header);
    const entries = Object.freeze(input.entries.map(snapshotIntentEntry));
    const body = intentSegmentBodyFromRecordsV1(header, entries);
    const segmentReference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.segmentReference),
    );
    const publishedHead = parseLibraryCoreIntentHeadV1(input.publishedHead);
    const bodyDigest = libraryCoreDigest("intent-segment-body", body);
    const publishedHeadDigest = intentHeadDigest(publishedHead);
    if (
      bodyDigest !== header.segment_digest ||
      publishedHeadDigest !== input.readBackHeadDigest ||
      publishedHead.library_id !== body.library_id ||
      publishedHead.epoch_id !== body.epoch_id ||
      publishedHead.actor_id !== body.actor_id ||
      publishedHead.next_intent_sequence !== body.last_intent_sequence + 1 ||
      publishedHead.latest_segment_digest !==
        segmentReference.descriptor.contentDigest ||
      !sameIntentReference(publishedHead.latest_segment, segmentReference)
    ) {
      throw new TypeError(
        "intent publication evidence does not match its exact segment and readback head",
      );
    }
    const publication = Object.freeze({
      actorId: body.actor_id,
      bodyDigest,
      epochId: body.epoch_id,
      expectedHeadDigest: input.expectedHeadDigest,
      firstIntentSequence: body.first_intent_sequence,
      headDigest: publishedHeadDigest,
      lastIntentSequence: body.last_intent_sequence,
      libraryId: body.library_id,
      segmentReference,
      storedContentDigest: segmentReference.descriptor.contentDigest,
    }) satisfies PortableIntentPublicationRecord;
    const receipt = (
      status: PwaLibraryCoreIntentPublicationReceiptV1["status"],
    ): PwaLibraryCoreIntentPublicationReceiptV1 =>
      Object.freeze({
        firstIntentSequence: body.first_intent_sequence,
        headDigest: publishedHeadDigest,
        lastIntentSequence: body.last_intent_sequence,
        operationCount: body.operation_count,
        status,
        storedContentDigest: segmentReference.descriptor.contentDigest,
      });

    const database = await this.#database();
    const transaction = database.transaction(
      [INTENT_ACTORS_STORE, INTENT_OPERATIONS_STORE, INTENT_PUBLICATIONS_STORE],
      "readwrite",
    );
    const actors = transaction.objectStore(INTENT_ACTORS_STORE);
    const operations = transaction.objectStore(INTENT_OPERATIONS_STORE);
    const publications = transaction.objectStore(INTENT_PUBLICATIONS_STORE);
    const actorRequest = actors.get([
      body.library_id,
      body.epoch_id,
      body.actor_id,
    ]);
    const publicationRequest = publications.get([
      body.library_id,
      body.epoch_id,
      body.actor_id,
      body.first_intent_sequence,
    ]);
    const actor = (await requestResult(actorRequest)) as
      PortableIntentActorRecord | undefined;
    const existingPublication = (await requestResult(publicationRequest)) as
      PortableIntentPublicationRecord | undefined;
    if (existingPublication) {
      if (!sameIntentPublication(existingPublication, publication)) {
        transaction.abort();
        throw new Error(
          "intent publication identity already exists with different evidence",
        );
      }
      const replayOperations = (await requestResult(
        operations.getAll(
          this.#keyRange.bound(
            [
              body.library_id,
              body.epoch_id,
              body.actor_id,
              body.first_intent_sequence,
            ],
            [
              body.library_id,
              body.epoch_id,
              body.actor_id,
              body.last_intent_sequence,
            ],
          ),
        ),
      )) as PortableIntentOperationRecord[];
      if (
        !actor ||
        actor.publishedThroughIntentSequence < body.last_intent_sequence ||
        replayOperations.length !== entries.length ||
        replayOperations.some(
          (stored, index) =>
            stored.publishedStoredDigest !==
              segmentReference.descriptor.contentDigest ||
            !sameIntentOperation(stored, {
              ...stored,
              entry: entries[index]!,
            }),
        )
      ) {
        transaction.abort();
        throw new Error(
          "intent publication replay does not match its durable receipt",
        );
      }
      await transactionDone(transaction);
      return receipt("already_recorded");
    }
    if (!actor) {
      transaction.abort();
      throw new Error("intent publication has no durable local actor");
    }
    const currentHead = intentActorHead(actor);
    if (
      actor.epochId !== body.epoch_id ||
      intentHeadDigest(currentHead) !== input.expectedHeadDigest ||
      actor.publishedThroughIntentSequence + 1 !== body.first_intent_sequence ||
      actor.latestPublishedStoredDigest !== body.previous_segment_digest
    ) {
      transaction.abort();
      throw new Error(
        "intent publication does not extend the exact durable actor head",
      );
    }
    const operationRange = this.#keyRange.bound(
      [
        body.library_id,
        body.epoch_id,
        body.actor_id,
        body.first_intent_sequence,
      ],
      [
        body.library_id,
        body.epoch_id,
        body.actor_id,
        body.last_intent_sequence,
      ],
    );
    const storedOperations = (await requestResult(
      operations.getAll(operationRange),
    )) as PortableIntentOperationRecord[];
    if (
      storedOperations.length !== entries.length ||
      storedOperations.some(
        (stored, index) =>
          stored.publishedStoredDigest !== null ||
          !sameIntentOperation(stored, {
            ...stored,
            entry: entries[index]!,
          }),
      )
    ) {
      transaction.abort();
      throw new Error(
        "intent publication does not match its durable unpublished operations",
      );
    }
    for (const stored of storedOperations) {
      operations.put({
        ...stored,
        publishedStoredDigest: segmentReference.descriptor.contentDigest,
      } satisfies PortableIntentOperationRecord);
    }
    publications.add(publication);
    actors.put({
      ...actor,
      latestPublishedSegment: segmentReference,
      latestPublishedStoredDigest: segmentReference.descriptor.contentDigest,
      publishedThroughIntentSequence: body.last_intent_sequence,
    } satisfies PortableIntentActorRecord);
    await transactionDone(transaction);
    return receipt("recorded");
  }

  async appendResultSegment(
    input: Readonly<{
      entries: readonly LibraryCoreIntentResultEntryV1[];
      header: LibraryCoreResultSegmentHeaderV1;
      reference: LibraryCoreImmutableObjectReferenceV1;
    }>,
  ): Promise<void> {
    this.#requireAvailable();
    const header = parseLibraryCoreResultSegmentHeaderV1(input.header);
    const entries = Object.freeze(
      input.entries.map((entry) => parseLibraryCoreIntentResultEntryV1(entry)),
    );
    const reference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.reference),
    );
    if (
      entries.length !== header.result_count ||
      reference.descriptor.objectKey.length === 0
    ) {
      throw new TypeError("result segment import evidence is incomplete");
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [INTENT_OPERATIONS_STORE, INTENT_RESULTS_STORE, RESULT_ACTORS_STORE],
      "readwrite",
    );
    const intentOperations = transaction.objectStore(INTENT_OPERATIONS_STORE);
    const results = transaction.objectStore(INTENT_RESULTS_STORE);
    const resultActors = transaction.objectStore(RESULT_ACTORS_STORE);
    const actorKey = [header.library_id, header.epoch_id, header.actor_id];
    const actor = (await requestResult(resultActors.get(actorKey))) as
      PortableResultActorRecord | undefined;
    const expectedSequence = actor?.nextResultSequence ?? 1;
    const expectedPreviousDigest = actor?.latestSegmentDigest ?? null;
    const existingRows = (await requestResult(
      results.getAll(
        this.#keyRange.bound(
          [
            header.library_id,
            header.epoch_id,
            header.actor_id,
            header.first_result_sequence,
          ],
          [
            header.library_id,
            header.epoch_id,
            header.actor_id,
            header.last_result_sequence,
          ],
        ),
      ),
    )) as PortableIntentResultRecord[];
    const records = entries.map(
      (entry) =>
        Object.freeze({
          actorId: header.actor_id,
          entry,
          epochId: header.epoch_id,
          libraryId: header.library_id,
          resultSequence: entry.result_sequence,
          segmentDigest: reference.descriptor.contentDigest,
          segmentReference: reference,
        }) satisfies PortableIntentResultRecord,
    );
    if (existingRows.length > 0) {
      if (
        existingRows.length !== records.length ||
        existingRows.some(
          (stored, index) => !sameIntentResult(stored, records[index]!),
        ) ||
        !actor ||
        actor.nextResultSequence < header.last_result_sequence + 1
      ) {
        transaction.abort();
        throw new Error(
          "result segment replay conflicts with durable PWA state",
        );
      }
      await transactionDone(transaction);
      return;
    }
    if (
      header.first_result_sequence !== expectedSequence ||
      header.previous_segment_digest !== expectedPreviousDigest ||
      (actor && actor.epochId !== header.epoch_id)
    ) {
      transaction.abort();
      throw new Error(
        "result segment does not extend the durable PWA result head",
      );
    }
    for (const record of records) {
      const intent = (await requestResult(
        intentOperations.get([
          record.libraryId,
          record.epochId,
          record.actorId,
          record.entry.intent_sequence,
        ]),
      )) as PortableIntentOperationRecord | undefined;
      if (
        !intent ||
        intent.entry.operation_id !== record.entry.intent_operation_id ||
        intent.epochId !== record.epochId
      ) {
        transaction.abort();
        throw new Error(
          "result segment references an unknown durable PWA intent",
        );
      }
      results.add(record);
    }
    resultActors.put({
      actorId: header.actor_id,
      epochId: header.epoch_id,
      latestSegment: reference,
      latestSegmentDigest: reference.descriptor.contentDigest,
      libraryId: header.library_id,
      nextResultSequence: header.last_result_sequence + 1,
    } satisfies PortableResultActorRecord);
    await transactionDone(transaction);
  }

  async readIntentResult(input: {
    readonly actorId: LibraryCoreOperationInstanceId;
    readonly epochId: LibraryCoreOperationInstanceId;
    readonly intentOperationId: LibraryCoreOperationInstanceId;
    readonly libraryId: LibraryCoreOperationInstanceId;
  }): Promise<PwaLibraryCoreIntentResultV1 | null> {
    this.#requireAvailable();
    const database = await this.#database();
    const transaction = database.transaction(INTENT_RESULTS_STORE, "readonly");
    const records = (await requestResult(
      transaction
        .objectStore(INTENT_RESULTS_STORE)
        .index("by_actor_intent_operation_id")
        .getAll([
          input.libraryId,
          input.epochId,
          input.actorId,
          input.intentOperationId,
        ]),
    )) as PortableIntentResultRecord[];
    await transactionDone(transaction);
    const latest = records
      .sort((left, right) => left.resultSequence - right.resultSequence)
      .at(-1);
    if (!latest) return null;
    return Object.freeze({
      intentOperationId: latest.entry.intent_operation_id,
      providerReceiptDigest: latest.entry.provider_receipt_digest,
      resultOperationId: latest.entry.result_operation_id,
      resultSequence: latest.entry.result_sequence,
      status: latest.entry.status,
    });
  }

  async readSelectedFeedPage(
    requestValue: unknown,
  ): Promise<PwaLibraryCorePortableFeedReaderResult> {
    if (this.#quiesced) {
      return portableFeedReaderFailure(
        "READER_UNAVAILABLE",
        "portable feed reader is quiesced",
      );
    }
    const request = parseLibraryCoreFeedPageRequestV1(requestValue);
    if (!request.ok) {
      return portableFeedReaderFailure("INVALID_REQUEST", request.error);
    }
    this.#expireFeedSessions();

    try {
      const database = await this.#database();
      const transaction = database.transaction(
        [GENERATIONS_STORE, CONTROL_STORE, FEED_ROWS_STORE],
        "readonly",
      );
      const selected = (await requestResult(
        transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
      )) as SelectedPortableGenerationRecord | undefined;
      const generation = selected
        ? ((await requestResult(
            transaction
              .objectStore(GENERATIONS_STORE)
              .get(selected.generationId),
          )) as PortableGenerationRecord | undefined)
        : undefined;
      if (
        !selected ||
        !generation ||
        generation.status !== "complete" ||
        generation.selectionSequence !== selected.selectionSequence
      ) {
        transaction.abort();
        return portableFeedReaderFailure(
          "RUNTIME_INACTIVE",
          "no complete authenticated portable generation is selected",
        );
      }

      const source = portableFeedSource(generation);
      const admission = this.#admitFeedSession(request.value, source);
      if (!admission.ok) {
        transaction.abort();
        return admission.result;
      }
      let lowerOrderKey = "";
      if (admission.cursor) {
        lowerOrderKey = `${reverseFeedSortKey(
          admission.cursor.sortAt,
        )}\u0000${lowerHex(
          TEXT_ENCODER.encode(admission.cursor.globalId).buffer,
        )}`;
      }
      const range = this.#keyRange.bound(
        [generation.generationId, lowerOrderKey],
        [generation.generationId, "\uffff"],
        admission.cursor !== null,
        false,
      );
      const rows: LibraryCoreFeedCardV1[] = [];
      let cursor = await requestResult(
        transaction.objectStore(FEED_ROWS_STORE).openCursor(range, "next"),
      );
      while (cursor && rows.length < request.value.limit) {
        const stored = cursor.value as PortableFeedRowRecord;
        const parsed = parseLibraryCoreFeedCardV1(stored.row);
        if (
          !parsed.ok ||
          stored.globalId !== parsed.value.globalId ||
          stored.sortAt !== (parsed.value.publishedAt ?? 0) ||
          stored.orderKey !== portableFeedRowOrderKey(parsed.value)
        ) {
          transaction.abort();
          return portableFeedReaderFailure(
            "READER_UNAVAILABLE",
            parsed.ok
              ? "portable feed row ordering is inconsistent"
              : parsed.error,
          );
        }
        rows.push(parsed.value);
        cursor.continue();
        cursor = await requestResult(cursor.request);
      }
      await transactionDone(transaction);

      const finalRow = rows.at(-1);
      const nextCursor =
        finalRow && rows.length === request.value.limit
          ? encodeLibraryCoreFeedPageCursorV1({
              ...source,
              globalId: finalRow.globalId,
              sortAt: finalRow.publishedAt ?? 0,
            })
          : null;
      const response = parseLibraryCoreFeedPageResponseV1(
        {
          nextCursor,
          queryId: request.value.queryId,
          rows,
          schemaVersion: request.value.schemaVersion,
          source,
          totalCount: generation.visibleFeedRowCount,
        },
        request.value,
      );
      if (!response.ok) {
        return portableFeedReaderFailure(
          response.error.includes("exceeds")
            ? "RESPONSE_TOO_LARGE"
            : "READER_UNAVAILABLE",
          response.error,
        );
      }
      const session = this.#feedSessions.get(request.value.readerSessionId);
      if (!session) {
        return portableFeedReaderFailure(
          "CURSOR_STALE",
          "portable feed reader session expired before its response completed",
        );
      }
      session.lastRequest = {
        cancellationId: request.value.cancellationId,
        cursor: request.value.cursor,
        limit: request.value.limit,
      };
      if (nextCursor === null) {
        this.#feedSessions.delete(request.value.readerSessionId);
      }
      return Object.freeze({ ok: true, value: response.value });
    } catch (error) {
      return portableFeedReaderFailure(
        "READER_UNAVAILABLE",
        error instanceof Error
          ? error.message
          : "portable IndexedDB feed reader failed",
      );
    }
  }

  cancelSelectedFeedReader(
    readerSessionId: string,
    cancellationId: string,
  ): boolean {
    const request = parseLibraryCoreFeedPageRequestV1({
      cancellationId,
      cursor: null,
      limit: 1,
      queryId: "feed_page_v1",
      readerSessionId,
      schemaVersion: 1,
    });
    if (!request.ok) return false;
    const session = this.#feedSessions.get(readerSessionId);
    if (session?.lastRequest?.cancellationId !== cancellationId) return false;
    return this.#feedSessions.delete(readerSessionId);
  }

  async readSelectedAuthenticatedOperationPage(
    input: ReadPwaLibraryCoreOperationPageInput,
  ): Promise<PwaLibraryCoreAuthenticatedOperationPage> {
    this.#requireAvailable();
    if (
      !Number.isSafeInteger(input.afterIngestSequence) ||
      input.afterIngestSequence < 0 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAXIMUM_COLLECTION_PAGE_ROWS
    ) {
      throw new TypeError("authenticated operation page request is invalid");
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, AUTHENTICATED_OPERATIONS_STORE, CONTROL_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence
    ) {
      transaction.abort();
      throw new Error("no complete portable checkpoint is selected");
    }
    const entries: LibraryCoreOperationSegmentEntryV1[] = [];
    const request = transaction
      .objectStore(AUTHENTICATED_OPERATIONS_STORE)
      .openCursor(
        this.#keyRange.bound(
          [generation.generationId, input.afterIngestSequence + 1],
          [
            generation.generationId,
            generation.authenticatedThroughIngestSequence,
          ],
        ),
        "next",
      );
    let cursor = await requestResult(request);
    while (cursor && entries.length < input.limit) {
      const stored = cursor.value as PortableAuthenticatedOperationRecord;
      entries.push(parseLibraryCoreOperationSegmentEntryV1(stored.entry));
      cursor.continue();
      cursor = await requestResult(cursor.request);
    }
    await transactionDone(transaction);
    const lastSequence = entries.at(-1)?.ingest_sequence ?? null;
    return Object.freeze({
      authenticatedThroughIngestSequence:
        generation.authenticatedThroughIngestSequence,
      entries: Object.freeze(entries),
      frontierDigest: generation.authenticatedFrontierDigest,
      importedThroughIngestSequence:
        generation.authenticatedThroughIngestSequence,
      latestOperationSegmentDigest: generation.latestAuthenticatedSegmentDigest,
      nextAfterIngestSequence:
        lastSequence !== null &&
        lastSequence < generation.authenticatedThroughIngestSequence
          ? lastSequence
          : null,
    });
  }

  async readSelectedReadState(
    entityId: string,
  ): Promise<PwaLibraryCoreReadState | null> {
    this.#requireAvailable();
    if (!entityId) {
      throw new TypeError("read-state entity ID is required");
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [CONTROL_STORE, READ_STATE_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const state = selected
      ? ((await requestResult(
          transaction
            .objectStore(READ_STATE_STORE)
            .get([selected.generationId, entityId]),
        )) as PortableReadStateRecord | undefined)
      : undefined;
    await transactionDone(transaction);
    return state
      ? Object.freeze({
          entityId: state.entityId,
          readAtMs: state.readAtMs,
          sourceOperationId: state.operationId,
        })
      : null;
  }

  async readSelectedMaterializedRow(
    registryKey: string,
    primaryKey: LibraryCoreCanonicalValue,
  ): Promise<Readonly<Record<string, LibraryCoreCanonicalValue>> | null> {
    this.#requireAvailable();
    if (!registryKey) {
      throw new TypeError("materialized-row registry key is required");
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [CONTROL_STORE, MATERIALIZED_ROWS_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const stored = selected
      ? ((await requestResult(
          transaction
            .objectStore(MATERIALIZED_ROWS_STORE)
            .get([
              selected.generationId,
              registryKey,
              canonicalStringKey(primaryKey),
            ]),
        )) as PortableMaterializedRowRecord | undefined)
      : undefined;
    await transactionDone(transaction);
    return stored ? Object.freeze({ ...stored.row }) : null;
  }

  async appendOperationSegment(input: {
    readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
    readonly header: LibraryCoreOperationSegmentHeaderV1;
    readonly reference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCoreOperationSegmentImportReceiptV1> {
    this.#requireAvailable();
    const header = parseLibraryCoreOperationSegmentHeaderV1(input.header);
    const entries = Object.freeze(
      input.entries.map(parseLibraryCoreOperationSegmentEntryV1),
    );
    const reference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.reference),
    );
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, OPERATIONS_STORE, SEGMENTS_STORE, CONTROL_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const operations = transaction.objectStore(OPERATIONS_STORE);
    const segments = transaction.objectStore(SEGMENTS_STORE);
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(generations.get(selected.generationId))) as
          PortableGenerationRecord | undefined)
      : undefined;
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header === null ||
      header.library_id !== generation.libraryId ||
      header.epoch_id !== generation.storageEpoch
    ) {
      transaction.abort();
      throw new Error(
        "operation segment has no matching complete selected checkpoint",
      );
    }
    const existing = (await requestResult(
      segments.get([generation.generationId, header.first_ingest_sequence]),
    )) as PortableSegmentRecord | undefined;
    if (existing) {
      if (
        existing.header.segment_digest === header.segment_digest &&
        existing.lastIngestSequence === header.last_ingest_sequence &&
        existing.objectKey === reference.descriptor.objectKey &&
        existing.storedByteLength === reference.descriptor.byteLength &&
        existing.storedContentDigest === reference.descriptor.contentDigest &&
        existing.transportObjectId === reference.transportObjectId &&
        generation.importedThroughIngestSequence >= header.last_ingest_sequence
      ) {
        await transactionDone(transaction);
        return this.#segmentReceipt(header);
      }
      transaction.abort();
      throw new Error(
        "operation segment sequence already exists with different bytes",
      );
    }
    if (
      header.first_ingest_sequence !==
        generation.importedThroughIngestSequence + 1 ||
      header.base_frontier_digest !== generation.frontierDigest ||
      header.previous_segment_digest !== generation.latestOperationSegmentDigest
    ) {
      transaction.abort();
      throw new Error(
        "operation segment is skipped, reordered, or does not extend the selected frontier",
      );
    }
    for (const entry of entries) {
      operations.add({
        entry,
        generationId: generation.generationId,
        ingestSequence: entry.ingest_sequence,
        operationId: entry.operation_id,
        segmentDigest: header.segment_digest,
      } satisfies PortableOperationRecord);
    }
    segments.add({
      firstIngestSequence: header.first_ingest_sequence,
      generationId: generation.generationId,
      header,
      lastIngestSequence: header.last_ingest_sequence,
      objectKey: reference.descriptor.objectKey,
      storedByteLength: reference.descriptor.byteLength,
      storedContentDigest: reference.descriptor.contentDigest,
      transportObjectId: reference.transportObjectId,
    } satisfies PortableSegmentRecord);
    generations.put({
      ...generation,
      frontierDigest: header.result_frontier_digest,
      importedThroughIngestSequence: header.last_ingest_sequence,
      latestOperationSegmentDigest: header.segment_digest,
    } satisfies PortableGenerationRecord);
    await transactionDone(transaction);
    return this.#segmentReceipt(header);
  }

  async readSelectedOperationPage(
    input: ReadPwaLibraryCoreOperationPageInput,
  ): Promise<PwaLibraryCoreOperationPage> {
    this.#requireAvailable();
    if (
      !Number.isSafeInteger(input.afterIngestSequence) ||
      input.afterIngestSequence < 0 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAXIMUM_COLLECTION_PAGE_ROWS
    ) {
      throw new TypeError("portable operation page request is invalid");
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, OPERATIONS_STORE, CONTROL_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence
    ) {
      transaction.abort();
      throw new Error("no complete portable checkpoint is selected");
    }
    const entries: LibraryCoreOperationSegmentEntryV1[] = [];
    const request = transaction
      .objectStore(OPERATIONS_STORE)
      .openCursor(
        this.#keyRange.bound(
          [generation.generationId, input.afterIngestSequence + 1],
          [generation.generationId, Number.MAX_SAFE_INTEGER],
        ),
        "next",
      );
    let cursor = await requestResult(request);
    while (cursor && entries.length < input.limit) {
      const stored = cursor.value as PortableOperationRecord;
      entries.push(parseLibraryCoreOperationSegmentEntryV1(stored.entry));
      cursor.continue();
      cursor = await requestResult(cursor.request);
    }
    await transactionDone(transaction);
    const lastSequence = entries.at(-1)?.ingest_sequence ?? null;
    return Object.freeze({
      entries: Object.freeze(entries),
      frontierDigest: generation.frontierDigest,
      importedThroughIngestSequence: generation.importedThroughIngestSequence,
      latestOperationSegmentDigest: generation.latestOperationSegmentDigest,
      nextAfterIngestSequence:
        lastSequence !== null &&
        lastSequence < generation.importedThroughIngestSequence
          ? lastSequence
          : null,
    });
  }

  async readSelectedCollectionPage(
    input: ReadPwaLibraryCorePortableCollectionPageInput,
  ): Promise<PwaLibraryCorePortableCollectionPage> {
    this.#requireAvailable();
    if (
      !LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.includes(
        input.collection,
      ) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAXIMUM_COLLECTION_PAGE_ROWS ||
      (input.afterOrdinal !== null &&
        (!Number.isSafeInteger(input.afterOrdinal) || input.afterOrdinal < 0))
    ) {
      throw new TypeError(
        "portable checkpoint collection page request is invalid",
      );
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, RECORDS_STORE, CONTROL_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    if (!selected) {
      transaction.abort();
      throw new Error("no complete portable checkpoint is selected");
    }
    const generation = (await requestResult(
      transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
    )) as PortableGenerationRecord | undefined;
    if (
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header === null
    ) {
      transaction.abort();
      throw new Error(
        "selected portable checkpoint is incomplete or inconsistent",
      );
    }

    const entries: LibraryCorePortableCheckpointEntryV1[] = [];
    const request = transaction
      .objectStore(RECORDS_STORE)
      .openCursor(
        collectionRange(
          this.#keyRange,
          generation.generationId,
          input.collection,
          input.afterOrdinal ?? -1,
        ),
        "next",
      );
    let cursor = await requestResult(request);
    while (cursor && entries.length < input.limit) {
      const stored = cursor.value as PortableEntryRecord;
      const parsed = parseLibraryCorePortableCheckpointRecordV1(stored.entry);
      if (
        parsed.kind !== "logical_checkpoint_entry" ||
        parsed.collection !== input.collection
      ) {
        transaction.abort();
        throw new Error("portable checkpoint collection row is inconsistent");
      }
      entries.push(parsed);
      cursor.continue();
      cursor = await requestResult(cursor.request);
    }
    await transactionDone(transaction);
    const finalOrdinal = entries.at(-1)?.ordinal ?? null;
    const declaredCount = generation.header.collection_counts[input.collection];
    return Object.freeze({
      entries: Object.freeze(entries),
      frontierDigest: generation.header.materializer_position.frontier_digest,
      generationId: generation.generationId,
      materializedDigest:
        generation.header.materializer_position.materialized_digest,
      nextOrdinal:
        finalOrdinal !== null && finalOrdinal + 1 < declaredCount
          ? finalOrdinal
          : null,
    });
  }

  async quiesce(): Promise<void> {
    this.#quiesced = true;
    this.#feedSessions.clear();
    if (this.#databasePromise) {
      const database = await this.#databasePromise;
      database.close();
      this.#databasePromise = null;
    }
    this.#activeGenerationId = null;
  }

  #admitFeedSession(
    request: LibraryCoreFeedPageRequestV1,
    source: LibraryCoreFeedPageSourceV1,
  ): PortableFeedSessionAdmission {
    const existing = this.#feedSessions.get(request.readerSessionId);
    if (existing) {
      if (!portableFeedSourceMatches(existing.source, source)) {
        this.#feedSessions.delete(request.readerSessionId);
        return Object.freeze({
          ok: false,
          result: portableFeedReaderFailure(
            "CURSOR_STALE",
            "portable feed source advanced during the reader session",
          ),
        });
      }
      if (
        existing.lastRequest?.cancellationId === request.cancellationId &&
        (existing.lastRequest.cursor !== request.cursor ||
          existing.lastRequest.limit !== request.limit)
      ) {
        return Object.freeze({
          ok: false,
          result: portableFeedReaderFailure(
            "INVALID_REQUEST",
            "cancellation identity was replayed for a different request",
          ),
        });
      }
    } else if (request.cursor !== null) {
      return Object.freeze({
        ok: false,
        result: portableFeedReaderFailure(
          "CURSOR_STALE",
          "cursor cannot resume an absent or expired reader session",
        ),
      });
    } else if (this.#feedSessions.size >= MAXIMUM_FEED_READER_SESSIONS) {
      return Object.freeze({
        ok: false,
        result: portableFeedReaderFailure(
          "SESSION_LIMIT",
          "portable feed reader session limit reached",
        ),
      });
    } else {
      this.#feedSessions.set(request.readerSessionId, {
        expiresAtMs: this.#now() + FEED_SESSION_MAXIMUM_AGE_MS,
        lastRequest: null,
        source,
      });
    }

    if (request.cursor === null) {
      return Object.freeze({ cursor: null, ok: true });
    }
    const cursor = decodeLibraryCoreFeedPageCursorV1(request.cursor);
    if (!cursor.ok || !portableFeedSourceMatches(cursor.value, source)) {
      return Object.freeze({
        ok: false,
        result: portableFeedReaderFailure(
          "CURSOR_STALE",
          "cursor source is no longer the authenticated portable frontier",
        ),
      });
    }
    return Object.freeze({ cursor: cursor.value, ok: true });
  }

  #expireFeedSessions(): void {
    const now = this.#now();
    for (const [readerSessionId, session] of this.#feedSessions) {
      if (session.expiresAtMs <= now) {
        this.#feedSessions.delete(readerSessionId);
      }
    }
  }

  #segmentReceipt(
    header: LibraryCoreOperationSegmentHeaderV1,
  ): LibraryCoreOperationSegmentImportReceiptV1 {
    return Object.freeze({
      firstIngestSequence: header.first_ingest_sequence,
      importedOperationCount: header.operation_count,
      lastIngestSequence: header.last_ingest_sequence,
      resultFrontierDigest: header.result_frontier_digest,
      segmentDigest: header.segment_digest,
    });
  }

  async #canonicalDigest(
    value: LibraryCoreCanonicalValue,
  ): Promise<LibraryCoreLowercaseHex64> {
    const bytes = encodeLibraryCoreCanonicalValue(value);
    return lowerHex(
      await this.#subtle.digest("SHA-256", exactArrayBuffer(bytes)),
    ) as LibraryCoreLowercaseHex64;
  }

  #requireAvailable(): void {
    if (this.#quiesced) {
      throw new Error("PWA Library Core portable checkpoint store is quiesced");
    }
  }

  #requireActiveGeneration(): LibraryCoreLowercaseHex64 {
    if (this.#activeGenerationId === null) {
      throw new Error("portable checkpoint import has not begun");
    }
    return this.#activeGenerationId;
  }

  #database(): Promise<IDBDatabase> {
    this.#requireAvailable();
    if (!this.#databasePromise) {
      this.#databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.#indexedDb.open(
          this.#databaseName,
          DATABASE_VERSION,
        );
        request.addEventListener("upgradeneeded", (event) => {
          const database = request.result;
          if (event.oldVersion > 0 && event.oldVersion < 8) {
            for (const storeName of [
              INTENT_ACTORS_STORE,
              INTENT_OPERATIONS_STORE,
              INTENT_TRANSACTIONS_STORE,
              INTENT_PUBLICATIONS_STORE,
            ]) {
              if (database.objectStoreNames.contains(storeName)) {
                database.deleteObjectStore(storeName);
              }
            }
          }
          if (!database.objectStoreNames.contains(GENERATIONS_STORE)) {
            database.createObjectStore(GENERATIONS_STORE, {
              keyPath: "generationId",
            });
          }
          if (!database.objectStoreNames.contains(RECORDS_STORE)) {
            database.createObjectStore(RECORDS_STORE, {
              keyPath: ["generationId", "collection", "ordinal"],
            });
          }
          if (!database.objectStoreNames.contains(PAGES_STORE)) {
            database.createObjectStore(PAGES_STORE, {
              keyPath: ["generationId", "pageIndex"],
            });
          }
          if (!database.objectStoreNames.contains(CONTROL_STORE)) {
            database.createObjectStore(CONTROL_STORE, { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
            const operations = database.createObjectStore(OPERATIONS_STORE, {
              keyPath: ["generationId", "ingestSequence"],
            });
            operations.createIndex(
              "by_generation_operation_id",
              ["generationId", "operationId"],
              { unique: true },
            );
          }
          if (!database.objectStoreNames.contains(SEGMENTS_STORE)) {
            database.createObjectStore(SEGMENTS_STORE, {
              keyPath: ["generationId", "firstIngestSequence"],
            });
          }
          if (!database.objectStoreNames.contains(ACTOR_ENROLLMENTS_STORE)) {
            database.createObjectStore(ACTOR_ENROLLMENTS_STORE, {
              keyPath: ["generationId", "actorId"],
            });
          }
          if (!database.objectStoreNames.contains(ACTOR_TIPS_STORE)) {
            database.createObjectStore(ACTOR_TIPS_STORE, {
              keyPath: ["generationId", "actorId"],
            });
          }
          if (
            !database.objectStoreNames.contains(AUTHENTICATED_OPERATIONS_STORE)
          ) {
            const authenticatedOperations = database.createObjectStore(
              AUTHENTICATED_OPERATIONS_STORE,
              {
                keyPath: ["generationId", "ingestSequence"],
              },
            );
            authenticatedOperations.createIndex(
              "by_generation_operation_id",
              ["generationId", "operationId"],
              { unique: true },
            );
          }
          if (
            !database.objectStoreNames.contains(AUTHENTICATED_SEGMENTS_STORE)
          ) {
            database.createObjectStore(AUTHENTICATED_SEGMENTS_STORE, {
              keyPath: ["generationId", "firstIngestSequence"],
            });
          }
          if (!database.objectStoreNames.contains(MATERIALIZED_ROWS_STORE)) {
            database.createObjectStore(MATERIALIZED_ROWS_STORE, {
              keyPath: ["generationId", "registryKey", "primaryKey"],
            });
          }
          if (!database.objectStoreNames.contains(READ_STATE_STORE)) {
            database.createObjectStore(READ_STATE_STORE, {
              keyPath: ["generationId", "entityId"],
            });
          }
          if (!database.objectStoreNames.contains(FEED_ROWS_STORE)) {
            database.createObjectStore(FEED_ROWS_STORE, {
              keyPath: ["generationId", "orderKey"],
            });
          }
          if (!database.objectStoreNames.contains(INTENT_ACTORS_STORE)) {
            database.createObjectStore(INTENT_ACTORS_STORE, {
              keyPath: ["libraryId", "epochId", "actorId"],
            });
          }
          if (!database.objectStoreNames.contains(INTENT_OPERATIONS_STORE)) {
            const intentOperations = database.createObjectStore(
              INTENT_OPERATIONS_STORE,
              {
                keyPath: ["libraryId", "epochId", "actorId", "intentSequence"],
              },
            );
            intentOperations.createIndex(
              "by_actor_operation_id",
              ["libraryId", "epochId", "actorId", "entry.operation_id"],
              { unique: true },
            );
          }
          if (!database.objectStoreNames.contains(INTENT_TRANSACTIONS_STORE)) {
            const intentTransactions = database.createObjectStore(
              INTENT_TRANSACTIONS_STORE,
              {
                keyPath: [
                  "libraryId",
                  "epochId",
                  "actorId",
                  "firstIntentSequence",
                ],
              },
            );
            intentTransactions.createIndex(
              "by_actor_transaction_id",
              ["libraryId", "epochId", "actorId", "transactionId"],
              { unique: true },
            );
          }
          if (!database.objectStoreNames.contains(INTENT_PUBLICATIONS_STORE)) {
            database.createObjectStore(INTENT_PUBLICATIONS_STORE, {
              keyPath: [
                "libraryId",
                "epochId",
                "actorId",
                "firstIntentSequence",
              ],
            });
          }
          if (!database.objectStoreNames.contains(INTENT_RESULTS_STORE)) {
            const intentResults = database.createObjectStore(
              INTENT_RESULTS_STORE,
              {
                keyPath: ["libraryId", "epochId", "actorId", "resultSequence"],
              },
            );
            intentResults.createIndex(
              "by_actor_intent_operation_id",
              ["libraryId", "epochId", "actorId", "entry.intent_operation_id"],
              { unique: false },
            );
          }
          if (!database.objectStoreNames.contains(RESULT_ACTORS_STORE)) {
            database.createObjectStore(RESULT_ACTORS_STORE, {
              keyPath: ["libraryId", "epochId", "actorId"],
            });
          }
          if (!database.objectStoreNames.contains(PWA_ACTOR_IDENTITIES_STORE)) {
            database.createObjectStore(PWA_ACTOR_IDENTITIES_STORE, {
              keyPath: "libraryId",
            });
          }
          if (
            !database.objectStoreNames.contains(
              PWA_ACTOR_ENROLLMENT_REQUESTS_STORE,
            )
          ) {
            database.createObjectStore(PWA_ACTOR_ENROLLMENT_REQUESTS_STORE, {
              keyPath: ["libraryId", "authorityStateDigest"],
            });
          }
          const hydrateFeedRows = (transaction: IDBTransaction): void => {
            const counts = new Map<string, number>();
            const materializedRows = transaction.objectStore(
              MATERIALIZED_ROWS_STORE,
            );
            const feedRows = transaction.objectStore(FEED_ROWS_STORE);
            const materializedCursorRequest = materializedRows.openCursor();
            materializedCursorRequest.addEventListener("success", () => {
              const cursor = materializedCursorRequest.result;
              if (cursor) {
                const materialized =
                  cursor.value as PortableMaterializedRowRecord;
                const feedRow = projectPortableFeedRow(
                  materialized.generationId,
                  materialized,
                );
                if (feedRow) {
                  feedRows.put(feedRow);
                  counts.set(
                    materialized.generationId,
                    (counts.get(materialized.generationId) ?? 0) + 1,
                  );
                }
                cursor.continue();
                return;
              }
              const generations = transaction.objectStore(GENERATIONS_STORE);
              const generationCursorRequest = generations.openCursor();
              generationCursorRequest.addEventListener("success", () => {
                const generationCursor = generationCursorRequest.result;
                if (!generationCursor) return;
                const generation =
                  generationCursor.value as PortableGenerationRecord;
                generationCursor.update({
                  ...generation,
                  visibleFeedRowCount: counts.get(generation.generationId) ?? 0,
                } satisfies PortableGenerationRecord);
                generationCursor.continue();
              });
            });
          };
          if (
            event.oldVersion > 0 &&
            event.oldVersion < 3 &&
            request.transaction
          ) {
            const generations =
              request.transaction.objectStore(GENERATIONS_STORE);
            const cursorRequest = generations.openCursor();
            cursorRequest.addEventListener("success", () => {
              const cursor = cursorRequest.result;
              if (!cursor) return;
              const generation = cursor.value as PortableGenerationRecord;
              const checkpointIngestSequence =
                generation.header?.materializer_position.ingest_sequence ?? 0;
              cursor.update({
                ...generation,
                authenticatedFrontierDigest:
                  generation.checkpointFrontierDigest,
                authenticatedThroughIngestSequence: checkpointIngestSequence,
                latestAuthenticatedSegmentDigest: null,
                visibleFeedRowCount: 0,
              } satisfies PortableGenerationRecord);
              cursor.continue();
            });
            const records = request.transaction.objectStore(RECORDS_STORE);
            const actorTips = request.transaction.objectStore(ACTOR_TIPS_STORE);
            const materializedRows = request.transaction.objectStore(
              MATERIALIZED_ROWS_STORE,
            );
            const recordCursorRequest = records.openCursor();
            recordCursorRequest.addEventListener("success", () => {
              const cursor = recordCursorRequest.result;
              if (!cursor) {
                if (request.transaction && event.oldVersion < 4) {
                  hydrateFeedRows(request.transaction);
                }
                return;
              }
              const stored = cursor.value as PortableEntryRecord;
              if (stored.collection === "actor_states") {
                const value = stored.entry.value as Readonly<
                  Record<string, unknown>
                >;
                actorTips.put({
                  acceptedChainDigest:
                    value.accepted_chain_digest as LibraryCoreLowercaseHex64,
                  acceptedOperationId:
                    value.accepted_operation_id as LibraryCoreOperationInstanceId | null,
                  acceptedSequence: value.accepted_sequence as number,
                  actorId: value.actor_id as LibraryCoreLowercaseHex64,
                  enrollmentCertificateDigest:
                    value.enrollment_certificate_digest as LibraryCoreLowercaseHex64,
                  generationId: stored.generationId,
                  retired: value.retired as boolean,
                } satisfies PortableActorTipRecord);
              }
              if (stored.collection === "materialized_rows") {
                const value = stored.entry.value as Readonly<
                  Record<string, unknown>
                >;
                materializedRows.put({
                  generationId: stored.generationId,
                  primaryKey: canonicalStringKey(
                    value.primary_key as LibraryCoreCanonicalValue,
                  ),
                  registryKey: value.registry_key as string,
                  row: value.row as Readonly<
                    Record<string, LibraryCoreCanonicalValue>
                  >,
                } satisfies PortableMaterializedRowRecord);
              }
              cursor.continue();
            });
          } else if (
            event.oldVersion > 0 &&
            event.oldVersion < 4 &&
            request.transaction
          ) {
            hydrateFeedRows(request.transaction);
          }
        });
        request.addEventListener(
          "success",
          () => {
            const database = request.result;
            database.addEventListener("versionchange", () => {
              database.close();
              this.#databasePromise = null;
            });
            resolve(database);
          },
          { once: true },
        );
        request.addEventListener(
          "error",
          () =>
            reject(
              request.error ??
                new Error("PWA Library Core portable database failed"),
            ),
          { once: true },
        );
        request.addEventListener(
          "blocked",
          () =>
            reject(
              new Error("PWA Library Core portable database upgrade blocked"),
            ),
          { once: true },
        );
      });
    }
    return this.#databasePromise;
  }
}

export function createPwaLibraryCorePortableCheckpointStore(
  options: PwaLibraryCorePortableCheckpointStoreOptions,
): PwaLibraryCorePortableCheckpointStore {
  return new PwaLibraryCorePortableCheckpointStore(options);
}
