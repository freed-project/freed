import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import { CONTENT_SIGNAL_KEYS } from "@freed/shared";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_CONTENT_RANGE_MAP_DIGEST_DOMAIN,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SQL,
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
  coerceLibraryCoreGeneratedSqliteQueryRow,
  LIBRARY_CORE_SQLITE_CONTENT_WORK_PROGRAMS,
  LIBRARY_CORE_SQLITE_LOCAL_MUTATION_PROGRAMS,
  LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS,
  LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS,
  LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS,
  libraryCoreOptimisticFieldsForEnvelopeV1,
  LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_OPERATION_IDS,
  LIBRARY_CORE_AGENT_QUERY_IDS,
  LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_NORMALIZED_CHECKPOINT_EXPORT_FORMAT,
  LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_FORMAT,
  LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS,
  LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  type LibraryCoreSqliteWorkerStatus,
  type LibraryCoreCanonicalValue,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerIntentPageRequestV1,
  type LibraryCoreFollowerIntentPageResponseV1,
  type LibraryCoreFollowerIntentPublicationReceiptV1,
  type LibraryCoreFollowerIntentPublicationV1,
  type LibraryCoreFollowerMutationContextV1,
  type LibraryCoreFollowerTransportContextV2,
  type LibraryCoreFollowerTransportPageRequestV2,
  type LibraryCoreFollowerTransportPageResponseV2,
  type LibraryCoreNormalizedIntentTransportPublicationReceiptV2,
  type LibraryCoreNormalizedIntentTransportPublicationV2,
  type LibraryCoreNormalizedResultTransportImportReceiptV2,
  type LibraryCoreNormalizedResultTransportImportV2,
  type LibraryCoreNormalizedOperationImportPageV2,
  type LibraryCoreNormalizedOperationImportReceiptV2,
  type LibraryCoreFollowerActorEnrollmentContextV2,
  type LibraryCoreFollowerActorRequestReceiptV2,
  type LibraryCoreFollowerActorEnrollmentReceiptV2,
  type LibraryCoreInstallFollowerActorEnrollmentV2,
  type LibraryCoreStoreFollowerActorRequestV2,
  type LibraryCoreFollowerResultApplyReceiptV1,
  type LibraryCoreFollowerResultApplyV1,
  type LibraryCoreFollowerResultVerificationAuthorityV1,
  type LibraryCoreVerifiedFollowerResultV1,
  type LibraryCoreAcceptedActorStateV1,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreSignatureInput,
  constructLibraryCoreActorEnrollmentBodyV1,
  isLibraryCoreCanonicalRecord,
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
  parseLibraryCoreInstallFollowerActorEnrollmentV2,
  parseLibraryCoreStoreFollowerActorRequestV2,
  snapshotLibraryCoreCausalFrontier,
  parseLibraryCoreFollowerIntentCommitV1,
  parseLibraryCoreFollowerIntentPageRequestV1,
  parseLibraryCoreFollowerIntentPageResponseV1,
  parseLibraryCoreFollowerIntentPublicationV1,
  parseLibraryCoreFollowerMutationContextV1,
  parseLibraryCoreFollowerTransportContextV2,
  parseLibraryCoreFollowerTransportPageRequestV2,
  parseLibraryCoreFollowerTransportPageResponseV2,
  LIBRARY_CORE_FOLLOWER_TRANSPORT_PAGE_CANONICAL_BYTE_LIMIT,
  parseLibraryCoreNormalizedIntentTransportPublicationV2,
  normalizedResultSegmentBodyFromRecordsV2,
  parseLibraryCoreNormalizedResultTransportImportV2,
  parseLibraryCoreNormalizedOperationImportPageV2,
  parseLibraryCoreFollowerResultApplyV1,
  parseLibraryCoreFollowerResultEnvelopeV1,
  sha256LowerHex,
  verifyLibraryCoreEd25519WithWebCrypto,
  verifyLibraryCoreOperationTransactionV1,
  verifyLibraryCoreFollowerResultV1,
  verifyLibraryCoreActorCapabilityCertificateV2,
  verifyLibraryCoreActorRetirementCertificateV1,
  decodeLibraryCoreFractionalNumbersV1,
  decodeLibraryCoreFeedPageCursorV1,
  decodeLibraryCoreFeedBrowsePageCursorV2,
  decodeLibraryCoreChangeFeedCursorV1,
  encodeLibraryCoreChangeFeedCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedBrowsePageCursorV2,
  libraryCoreFeedBrowseBindingDigestV3,
  libraryCoreFeedBrowseFilterDigestV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  parseLibraryCoreFeedBrowsePageRequestV3,
  parseLibraryCoreFeedBrowsePageResponseV3,
  parseLibraryCoreChangeFeedRequestV1,
  parseLibraryCoreChangeFeedResponseV1,
  parseLibraryCoreLocalChangeFeedRequestV1,
  parseLibraryCoreLocalChangeFeedResponseV1,
  parseLibraryCoreOptimisticFieldsRequestV1,
  parseLibraryCoreOptimisticFieldsResponseV1,
  parseLibraryCoreFacetSummaryRequestV1,
  parseLibraryCoreFacetSummaryResponseV1,
  parseLibraryCoreSavedAnalyticsRequestV2,
  parseLibraryCoreSavedAnalyticsResponseV2,
  decodeLibraryCoreSavedFeedPageCursorV2,
  encodeLibraryCoreSavedFeedPageCursorV2,
  parseLibraryCoreSavedFeedCardV1,
  parseLibraryCoreSavedFeedPageRequestV2,
  parseLibraryCoreSavedFeedPageResponseV2,
  parseLibraryCorePreferencesSnapshotRequestV1,
  parseLibraryCorePreferencesSnapshotResponseV1,
  parseLibraryCoreItemDetailRequestV1,
  parseLibraryCoreItemDetailResponseV1,
  parseLibraryCoreItemReaderBodyRequestV1,
  parseLibraryCoreItemReaderBodyResponseV1,
  decodeLibraryCoreItemScanCursorV1,
  encodeLibraryCoreItemScanCursorV1,
  parseLibraryCoreItemScanRequestV1,
  parseLibraryCoreItemScanResponseV1,
  decodeLibraryCoreContentFetchPageCursorV1,
  encodeLibraryCoreContentFetchPageCursorV1,
  parseLibraryCoreContentFetchPageRequestV1,
  parseLibraryCoreContentFetchPageResponseV1,
  decodeLibraryCoreProviderMediaPageCursorV1,
  encodeLibraryCoreProviderMediaPageCursorV1,
  libraryCoreProviderMediaBindingDigestV1,
  parseLibraryCoreProviderMediaPageRequestV1,
  parseLibraryCoreProviderMediaPageResponseV1,
  parseLibraryCorePersonDetailRequestV1,
  parseLibraryCorePersonDetailResponseV1,
  decodeLibraryCorePersonTimelineCursorV1,
  encodeLibraryCorePersonTimelineCursorV1,
  libraryCorePersonTimelinePersonDigestV1,
  parseLibraryCorePersonTimelineRequestV1,
  parseLibraryCorePersonTimelineResponseV1,
  parseLibraryCoreMapMarkersRequestV1,
  parseLibraryCoreMapMarkersResponseV1,
  parseLibraryCoreStoryWallCandidatesRequestV1,
  parseLibraryCoreStoryWallCandidatesResponseV1,
  parseLibraryCoreAccountDetailRequestV1,
  parseLibraryCoreAccountDetailResponseV1,
  parseLibraryCoreContactMatchRequestV1,
  parseLibraryCoreContactMatchResponseV1,
  parseLibraryCoreFilterScopeSummaryRequestV1,
  parseLibraryCoreFilterScopeSummaryResponseV1,
  decodeLibraryCoreFriendsDirectoryCursorV1,
  encodeLibraryCoreFriendsDirectoryCursorV1,
  libraryCoreFriendsDirectoryBindingDigestV1,
  parseLibraryCoreFriendsDirectoryPageRequestV1,
  parseLibraryCoreFriendsDirectoryPageResponseV1,
  parseLibraryCoreFriendCandidateReviewRequestV1,
  parseLibraryCoreFriendCandidateReviewResponseV1,
  parseLibraryCoreAccountLinkCandidatesRequestV1,
  parseLibraryCoreAccountLinkCandidatesResponseV1,
  parseLibraryCoreAccountPickerPageRequestV1,
  parseLibraryCoreAccountPickerPageResponseV1,
  parseLibraryCorePersonPickerPageRequestV1,
  parseLibraryCorePersonPickerPageResponseV1,
  LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_FRIENDS_DIRECTORY_RECENT_WINDOW_MS,
  parseLibraryCoreRssFeedDetailRequestV1,
  parseLibraryCoreRssFeedDetailResponseV1,
  decodeLibraryCoreAccountTimelineCursorV1,
  encodeLibraryCoreAccountTimelineCursorV1,
  libraryCoreAccountTimelineAccountDigestV1,
  parseLibraryCoreAccountTimelineRequestV1,
  parseLibraryCoreAccountTimelineResponseV1,
  decodeLibraryCoreSearchPageCursorV1,
  encodeLibraryCoreSearchPageCursorV1,
  libraryCoreSearchPageRequestDigestV1,
  parseLibraryCoreSearchPageRequestV1,
  parseLibraryCoreSearchPageResponseV1,
  scoreLibraryCoreSearchFieldsWithBudgetV1,
  tokenizeLibraryCoreSearchTextV1,
  isLibraryCoreEntityId,
  decodeLibraryCoreIdentityPageCursorV1,
  encodeLibraryCoreIdentityPageCursorV1,
  parseLibraryCoreAccountGraphPageRequestV1,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageRequestV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedPageRequestV1,
  parseLibraryCoreRssFeedPageResponseV1,
  parseLibraryCorePersonsGraphRequestV1,
  parseLibraryCorePersonsGraphResponseV1,
  parseLibraryCoreDeviceGraphLayoutMutationV1,
  parseLibraryCoreDeviceGraphLayoutMutationResultV1,
  digestLibraryCoreDeviceContactSyncMutationV1,
  parseLibraryCoreDeviceContactMutationReceiptV1,
  parseLibraryCoreDeviceContactQueryRequestV1,
  parseLibraryCoreDeviceContactQueryResponseV1,
  parseLibraryCoreDeviceContactV1,
  LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES,
  parseLibraryCoreDeviceContactSyncMutationV1,
  parseLibraryCoreContentPolicyMutationReceiptV1,
  parseLibraryCoreContentPolicyMutationV1,
  parseLibraryCoreContentCompletionReceiptV1,
  parseLibraryCoreContentCompletionRequestV1,
  parseLibraryCoreContentStateRequestV1,
  parseLibraryCoreContentStateV1,
  parseLibraryCoreEvictionCandidatePageRequestV1,
  parseLibraryCoreEvictionCandidatePageV1,
  parseLibraryCoreHydrationCandidatePageRequestV1,
  parseLibraryCoreHydrationCandidatePageV1,
  createLibraryCoreContentRangeStorageKeyV1,
  parseLibraryCoreVerifiedContentRangePublicationV1,
  parseLibraryCoreVerifiedContentRangeReceiptV1,
  digestLibraryCoreAnyScopeActionRequestV1,
  parseLibraryCoreAnyScopeActionRequestV1,
  type LibraryCoreAnyScopeActionRequestV1,
  type LibraryCoreScopeActionStagePageV1,
  type LibraryCoreScopeActionStageStatusV1,
  encodeLibraryCoreCanonicalBase64,
  assertLibraryCoreNormalizedCheckpointPageBytesV2,
  createLibraryCoreMediaBlobDigestStateV1,
  decodeLibraryCoreCanonicalValue,
  decodeLibraryCoreContentChunkBytesV1,
  digestLibraryCoreMediaBlobBytesV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  createLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreActivateNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointSelectionV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  LibraryCoreSha256,
  libraryCoreNormalizedCheckpointSqlitePayloadV2,
  type LibraryCoreActivateNormalizedCheckpointStageV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointExportPageV2,
  type LibraryCoreNormalizedCheckpointPrimaryKeyV2,
  type LibraryCorePinnedNormalizedCheckpointExportRequestV2,
  type LibraryCoreFeedCardV1,
  type LibraryCoreChangeFeedRequestV1,
  type LibraryCoreChangeFeedResponseV1,
  type LibraryCoreLocalChangeFeedRequestV1,
  type LibraryCoreLocalChangeFeedResponseV1,
  type LibraryCoreOptimisticFieldsRequestV1,
  type LibraryCoreOptimisticFieldsResponseV1,
  type LibraryCoreFeedPageRequestV1,
  type LibraryCoreFeedPageResponseV1,
  type LibraryCoreFeedBrowsePageRequestV3,
  type LibraryCoreFeedBrowsePageResponseV3,
  type LibraryCoreFacetSummaryRequestV1,
  type LibraryCoreFacetSummaryResponseV1,
  type LibraryCoreSavedAnalyticsRequestV2,
  type LibraryCoreSavedAnalyticsResponseV2,
  type LibraryCoreSavedFeedCardV1,
  type LibraryCoreSavedFeedPageRequestV2,
  type LibraryCoreSavedFeedPageResponseV2,
  type LibraryCorePreferencesSnapshotRequestV1,
  type LibraryCorePreferencesSnapshotResponseV1,
  type LibraryCoreItemDetailRequestV1,
  type LibraryCoreItemDetailResponseV1,
  type LibraryCoreItemReaderBodyRequestV1,
  type LibraryCoreItemReaderBodyResponseV1,
  type LibraryCoreItemScanRequestV1,
  type LibraryCoreItemScanResponseV1,
  type LibraryCoreContentFetchPageRequestV1,
  type LibraryCoreContentFetchPageResponseV1,
  type LibraryCoreProviderMediaPageRequestV1,
  type LibraryCoreProviderMediaPageResponseV1,
  type LibraryCoreProviderMediaRowV1,
  type LibraryCoreContentPolicyMutationReceiptV1,
  type LibraryCoreContentPolicyMutationV1,
  type LibraryCoreContentCompletionReceiptV1,
  type LibraryCoreContentCompletionRequestV1,
  type LibraryCoreContentStateRequestV1,
  type LibraryCoreContentStateV1,
  type LibraryCoreContentWorkSourceV1,
  type LibraryCoreEvictionCandidatePageRequestV1,
  type LibraryCoreEvictionCandidatePageV1,
  type LibraryCoreHydrationCandidatePageRequestV1,
  type LibraryCoreHydrationCandidatePageV1,
  type LibraryCoreVerifiedContentRangePublicationV1,
  type LibraryCoreVerifiedContentRangeReceiptV1,
  type LibraryCorePersonDetailRequestV1,
  type LibraryCorePersonDetailResponseV1,
  type LibraryCorePersonTimelineRequestV1,
  type LibraryCorePersonTimelineResponseV1,
  type LibraryCoreMapMarkerV1,
  type LibraryCoreMapMarkersRequestV1,
  type LibraryCoreMapMarkersResponseV1,
  type LibraryCoreStoryWallCandidateV1,
  type LibraryCoreStoryWallCandidatesRequestV1,
  type LibraryCoreStoryWallCandidatesResponseV1,
  type LibraryCoreAccountDetailRequestV1,
  type LibraryCoreAccountDetailResponseV1,
  type LibraryCoreContactMatchRequestV1,
  type LibraryCoreContactMatchResponseV1,
  type LibraryCoreFilterScopeSummaryRequestV1,
  type LibraryCoreFilterScopeSummaryResponseV1,
  type LibraryCoreFriendsDirectoryPageRequestV1,
  type LibraryCoreFriendsDirectoryPageResponseV1,
  type LibraryCoreFriendCandidateReviewRequestV1,
  type LibraryCoreFriendCandidateReviewResponseV1,
  type LibraryCoreAccountLinkCandidatesRequestV1,
  type LibraryCoreAccountLinkCandidatesResponseV1,
  type LibraryCoreAccountPickerPageRequestV1,
  type LibraryCoreAccountPickerPageResponseV1,
  type LibraryCorePersonPickerPageRequestV1,
  type LibraryCorePersonPickerPageResponseV1,
  type LibraryCoreRssFeedDetailRequestV1,
  type LibraryCoreRssFeedDetailResponseV1,
  type LibraryCoreAccountTimelineRequestV1,
  type LibraryCoreAccountTimelineResponseV1,
  type LibraryCoreSearchFieldV1,
  type LibraryCoreSearchPageRequestV1,
  type LibraryCoreSearchPageResponseV1,
  type LibraryCoreAccountGraphPageRequestV1,
  type LibraryCoreAccountGraphPageResponseV1,
  type LibraryCorePersonGraphPageRequestV1,
  type LibraryCorePersonGraphPageResponseV1,
  type LibraryCoreRssFeedPageRequestV1,
  type LibraryCoreRssFeedPageResponseV1,
  type LibraryCorePersonsGraphRequestV1,
  type LibraryCorePersonsGraphResponseV1,
  type LibraryCoreDeviceGraphLayoutMutationV1,
  type LibraryCoreDeviceGraphLayoutMutationResultV1,
  type LibraryCoreDeviceContactMutationReceiptV1,
  type LibraryCoreDeviceContactQueryRequestV1,
  type LibraryCoreDeviceContactQueryResponseV1,
  type LibraryCoreDeviceContactSyncMutationV1,
  type LibraryCoreSqliteQueryRequest,
  type LibraryCoreSqliteQueryResponseFor,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointSelectionV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreSqliteMutationProgramId,
} from "@freed/shared/library-core";

type LibraryCoreSqliteMutationProgram =
  (typeof LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS)[LibraryCoreSqliteMutationProgramId];

const stagedRecordDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-bytes/staged-checkpoint-record\u0000",
  (character) => character.charCodeAt(0),
);
const checkpointDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-records/normalized-checkpoint\u0000",
  (character) => character.charCodeAt(0),
);
const contentRangeMapDigestPrefix = Uint8Array.from(
  LIBRARY_CORE_CONTENT_RANGE_MAP_DIGEST_DOMAIN,
  (character) => character.charCodeAt(0),
);
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

function lengthBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(length), false);
  return bytes;
}

function signedIntegerBytes(value: number): Uint8Array {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigInt64(0, BigInt(value), false);
  return output;
}

const checkpointFrontierDigestPrefix = Uint8Array.from(
  "freed.library-core.v2/digest-records/checkpoint-frontier\u0000",
  (character) => character.charCodeAt(0),
);

function validateCheckpointHeader(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): void {
  if (
    record.registryKey !== "00_checkpoint_header" ||
    record.primaryKey !== "checkpoint"
  ) {
    throw new Error("normalized checkpoint header identity is invalid");
  }
  const libraryId = record.payload.libraryId;
  const authorityEpoch = record.payload.authorityEpoch;
  const sourceRevision = record.payload.sourceRevision;
  if (
    typeof libraryId !== "string" ||
    typeof authorityEpoch !== "string" ||
    !Number.isSafeInteger(sourceRevision) ||
    record.payload.schemaVersion !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION ||
    record.payload.checkpointId !==
      `${libraryId}:${authorityEpoch}:${String(sourceRevision)}`
  ) {
    throw new Error("normalized checkpoint header version identity is invalid");
  }
}

function safeInteger(value: unknown, label: string): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new Error(`${label} is not a safe SQLite integer`);
  }
  return number;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} is not SQLite text`);
  }
  return value;
}

function canonicalRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has unknown or missing fields`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function coreDigest(
  domain: Parameters<typeof encodeLibraryCoreDigestInput>[0],
  value: unknown,
) {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
  );
}

function bytes(value: SqlValue | undefined, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${label} is not a SQLite blob`);
  }
  return value;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function nullableText(
  value: SqlValue | undefined,
  label: string,
): string | null {
  return value === null ? null : text(value, label);
}

function nullableInteger(
  value: SqlValue | undefined,
  label: string,
  allowNegativeOne = false,
): number | null {
  if (value === null) return null;
  const integer = safeInteger(value, label);
  if (integer < 0 && !(allowNegativeOne && integer === -1)) {
    throw new Error(`${label} is negative`);
  }
  return integer;
}

function deviceContactMutationReceipt(
  database: Database,
  generationId: string | null,
  changed: boolean,
): LibraryCoreDeviceContactMutationReceiptV1 {
  const stateRows = database.exec({
    sql: `SELECT active_generation_id, revision
          FROM library_device_contact_sync_state
          WHERE singleton_id = 1;`,
    rowMode: "array",
    returnValue: "resultRows",
  });
  if (stateRows.length !== 1) {
    throw new Error("device contact sync state is unavailable");
  }
  let stagedContactCount = 0;
  let matchedContactCount = 0;
  if (generationId !== null) {
    const generationRows = database.exec({
      sql: `SELECT staged_contact_count, matched_contact_count
            FROM library_device_contact_generations
            WHERE generation_id = ?1 COLLATE BINARY;`,
      bind: [generationId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (generationRows.length === 1) {
      stagedContactCount = safeInteger(
        generationRows[0]![0],
        "device contact staged count",
      );
      matchedContactCount = safeInteger(
        generationRows[0]![1],
        "device contact matched count",
      );
    } else if (generationRows.length > 1) {
      throw new Error("device contact generation is ambiguous");
    }
  }
  const parsed = parseLibraryCoreDeviceContactMutationReceiptV1({
    activeGenerationId: nullableText(
      stateRows[0]![0],
      "active device contact generation",
    ),
    changed,
    generationId,
    matchedContactCount,
    revision: safeInteger(stateRows[0]![1], "device contact revision"),
    schemaVersion: 1,
    stagedContactCount,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function deviceContactFromDatabase(
  database: Database,
  generationId: string,
  resourceName: string,
) {
  const root = database.exec({
    sql: `SELECT etag, display_name, given_name, family_name, middle_name, deleted
          FROM library_device_contacts
          WHERE generation_id = ?1 COLLATE BINARY AND resource_name = ?2 COLLATE BINARY;`,
    bind: [generationId, resourceName],
    rowMode: "array",
    returnValue: "resultRows",
  });
  if (root.length !== 1) throw new Error("device contact row is unavailable");
  const values = (table: string) =>
    database
      .exec({
        sql: `SELECT value, type_value FROM ${table}
            WHERE generation_id = ?1 COLLATE BINARY AND resource_name = ?2 COLLATE BINARY
            ORDER BY ordinal;`,
        bind: [generationId, resourceName],
        rowMode: "array",
        returnValue: "resultRows",
      })
      .map((row) => ({
        ...(row[1] === null
          ? {}
          : { type: text(row[1], "device contact value type") }),
        value: text(row[0], "device contact value"),
      }));
  const contact = parseLibraryCoreDeviceContactV1({
    emails: values("library_device_contact_emails"),
    ...(root[0]![0] === null
      ? {}
      : { etag: text(root[0]![0], "device contact etag") }),
    ...(safeInteger(root[0]![5], "device contact deleted") === 1
      ? { metadata: { deleted: true } }
      : {}),
    name: {
      ...(root[0]![1] === null
        ? {}
        : { displayName: text(root[0]![1], "device contact display name") }),
      ...(root[0]![2] === null
        ? {}
        : { givenName: text(root[0]![2], "device contact given name") }),
      ...(root[0]![3] === null
        ? {}
        : { familyName: text(root[0]![3], "device contact family name") }),
      ...(root[0]![4] === null
        ? {}
        : { middleName: text(root[0]![4], "device contact middle name") }),
    },
    organizations: database
      .exec({
        sql: `SELECT name, title FROM library_device_contact_organizations
            WHERE generation_id = ?1 COLLATE BINARY AND resource_name = ?2 COLLATE BINARY ORDER BY ordinal;`,
        bind: [generationId, resourceName],
        rowMode: "array",
        returnValue: "resultRows",
      })
      .map((row) => ({
        ...(row[0] === null
          ? {}
          : { name: text(row[0], "device contact organization") }),
        ...(row[1] === null
          ? {}
          : { title: text(row[1], "device contact organization title") }),
      })),
    phones: values("library_device_contact_phones"),
    photos: database
      .exec({
        sql: `SELECT url, is_default FROM library_device_contact_photos
            WHERE generation_id = ?1 COLLATE BINARY AND resource_name = ?2 COLLATE BINARY ORDER BY ordinal;`,
        bind: [generationId, resourceName],
        rowMode: "array",
        returnValue: "resultRows",
      })
      .map((row) => ({
        url: text(row[0], "device contact photo"),
        ...(safeInteger(row[1], "device contact photo default") === 1
          ? { default: true }
          : {}),
      })),
    resourceName,
  });
  if (contact === null) throw new Error("device contact row is invalid");
  return contact;
}

function nullableFiniteNumber(
  value: SqlValue | undefined,
  label: string,
): number | null {
  if (value === null) return null;
  const number = typeof value === "bigint" ? Number(value) : value;
  if (
    typeof number !== "number" ||
    !Number.isFinite(number) ||
    Math.abs(number) > 1_000_000_000
  ) {
    throw new Error(`${label} is not a bounded SQLite number`);
  }
  return number;
}

function sqliteMutationProgram(
  operationType: string,
): LibraryCoreSqliteMutationProgram {
  if (!Object.hasOwn(LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS, operationType)) {
    throw new TypeError(
      `SQLite mutation materializer is not registered for ${operationType}`,
    );
  }
  return LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS[
    operationType as LibraryCoreSqliteMutationProgramId
  ];
}

function nullableBoolean(
  value: SqlValue | undefined,
  label: string,
): boolean | null {
  if (value === null) return null;
  const integer = safeInteger(value, label);
  if (integer !== 0 && integer !== 1)
    throw new Error(`${label} is not boolean`);
  return integer === 1;
}

function requiredBoolean(value: SqlValue | undefined, label: string): boolean {
  const parsed = nullableBoolean(value, label);
  if (parsed === null) throw new Error(`${label} is null`);
  return parsed;
}

function stringArray(
  value: SqlValue | undefined,
  label: string,
): readonly string[] {
  const parsed = JSON.parse(text(value, label)) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${label} is not a text array`);
  }
  return Object.freeze(parsed);
}

function blobBytes(value: SqlValue | undefined, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${label} is not SQLite bytes`);
  }
  return value;
}

function feedCardFromSqliteRow(
  row: Record<string, SqlValue>,
): LibraryCoreFeedCardV1 {
  const candidate = {
    archived: nullableBoolean(row.archived, "feed archived"),
    authorAvatarUrl: nullableText(row.authorAvatarUrl, "feed author avatar"),
    authorDisplayName: nullableText(
      row.authorDisplayName,
      "feed author display name",
    ),
    authorHandle: nullableText(row.authorHandle, "feed author handle"),
    authorId: nullableText(row.authorId, "feed author identity"),
    capturedAt: nullableInteger(row.capturedAt, "feed captured time"),
    contentSignalTags: stringArray(
      row.contentSignalTagsJson,
      "feed signal tags",
    ),
    contentText: nullableText(row.contentText, "feed content text"),
    contentType: nullableText(row.contentType, "feed content type"),
    engagementComments: nullableInteger(
      row.engagementComments,
      "feed comments",
    ),
    engagementLikes: nullableInteger(row.engagementLikes, "feed likes"),
    eventConfidenceBasisPoints: nullableInteger(
      row.eventConfidenceBasisPoints,
      "feed event confidence",
    ),
    eventStartsAt: nullableInteger(row.eventStartsAt, "feed event start"),
    globalId: text(row.globalId, "feed item identity"),
    liked: nullableBoolean(row.liked, "feed liked"),
    likedAt: nullableInteger(row.likedAt, "feed liked time"),
    likedSyncedAt: nullableInteger(
      row.likedSyncedAt,
      "feed like sync time",
      true,
    ),
    linkPreviewTitle: nullableText(row.linkPreviewTitle, "feed link title"),
    locationName: nullableText(row.locationName, "feed location"),
    mediaTypes: stringArray(row.mediaTypesJson, "feed media types"),
    mediaUrls: stringArray(row.mediaUrlsJson, "feed media URLs"),
    platform: nullableText(row.platform, "feed platform"),
    publishedAt: nullableInteger(row.publishedAt, "feed published time"),
    readAt: nullableInteger(row.readAt, "feed read time"),
    readingTimeMinutes: nullableInteger(
      row.readingTimeMinutes,
      "feed reading time",
    ),
    saved: nullableBoolean(row.saved, "feed saved"),
    sourceUrl: nullableText(row.sourceUrl, "feed source URL"),
    tags: stringArray(row.tagsJson, "feed tags"),
  };
  const parsed = parseLibraryCoreFeedCardV1(candidate);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function savedFeedCardFromSqliteRow(
  row: Record<string, SqlValue>,
): LibraryCoreSavedFeedCardV1 {
  const parsed = parseLibraryCoreSavedFeedCardV1({
    ...feedCardFromSqliteRow(row),
    savedAt: nullableInteger(row.savedAt, "saved feed saved time"),
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function searchScoreFromSqliteRow(
  row: Record<string, SqlValue>,
  queryTerms: readonly string[],
): number {
  const fields: LibraryCoreSearchFieldV1[] = [];
  let termCount = 0;
  const collect = (value: string, weight: number, maximumTerms = 368) => {
    if (termCount >= maximumTerms || value.length === 0) return;
    const terms = tokenizeLibraryCoreSearchTextV1(
      value,
      maximumTerms - termCount,
    );
    if (terms.length === 0) return;
    fields.push(Object.freeze({ terms, weight }));
    termCount += terms.length;
  };
  const nullableSearchText = (key: string) =>
    row[key] === null ? "" : text(row[key], `search ${key}`);
  const joined = (key: string) =>
    stringArray(row[key], `search ${key}`).join(" ");
  collect(nullableSearchText("linkPreviewTitle"), 4);
  collect(
    `${joined("searchTopicsJson")} ${joined("contentSignalTagsJson")}`,
    3,
  );
  collect(
    [
      nullableSearchText("searchEventTitle"),
      nullableSearchText("searchEventLocation"),
      nullableSearchText("searchEventEvidence"),
      nullableSearchText("locationName"),
    ].join(" "),
    3,
  );
  collect(joined("tagsJson"), 3);
  collect(nullableSearchText("authorDisplayName"), 3);
  collect(nullableSearchText("authorHandle"), 3);
  collect(nullableSearchText("authorId"), 3);
  collect(nullableSearchText("searchContentText"), 2);
  collect(nullableSearchText("searchLinkDescription"), 2);
  collect(nullableSearchText("searchRssFeedTitle"), 2);
  collect(joined("searchHighlightsJson"), 2);
  collect(nullableSearchText("searchPreservedText"), 1);
  collect(nullableSearchText("searchAccountAliases"), 3, 384);
  return scoreLibraryCoreSearchFieldsWithBudgetV1(fields, queryTerms, 65_536)
    .score;
}

export class PwaLibraryCoreSqliteEngine {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #sqliteVersion: string;
  readonly #subtle: SubtleCrypto;
  #connectionGeneration = 0;

  constructor(
    database: Database,
    sqliteVersion: string,
    dependencies: Readonly<{
      now?: () => number;
      subtle?: SubtleCrypto;
    }> = {},
  ) {
    this.#database = database;
    this.#now = dependencies.now ?? Date.now;
    this.#sqliteVersion = sqliteVersion;
    this.#subtle = dependencies.subtle ?? crypto.subtle;
  }

  initialize(): LibraryCoreSqliteWorkerStatus {
    this.#database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY;",
    );
    const userVersion = safeInteger(
      this.#database.exec({
        sql: "PRAGMA user_version;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "SQLite user_version",
    );
    const applicationId = safeInteger(
      this.#database.exec({
        sql: "PRAGMA application_id;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "SQLite application_id",
    );
    if (userVersion === 0) {
      if (applicationId !== 0) {
        throw new Error("PWA Library SQLite application identity is foreign");
      }
      this.#database.exec(LIBRARY_CORE_NORMALIZED_SCHEMA_SQL);
      this.#database.exec({
        sql: `INSERT INTO library_storage_meta
              (singleton_id, contract_version, schema_version, protocol_version, schema_sha256)
              VALUES (1, ?1, ?2, ?3, ?4);`,
        bind: [
          LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
          LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
          LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
          LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
        ],
      });
      this.#database.exec(
        `PRAGMA user_version = ${LIBRARY_CORE_SQLITE_SCHEMA_VERSION};`,
      );
    } else if (userVersion !== LIBRARY_CORE_SQLITE_SCHEMA_VERSION) {
      throw new Error("PWA Library SQLite schema version is unsupported");
    } else if (applicationId !== LIBRARY_CORE_SQLITE_APPLICATION_ID) {
      throw new Error("PWA Library SQLite application identity is unsupported");
    }
    this.#verifyStorageIdentity();
    for (const program of Object.values(
      LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS,
    )) {
      this.#database.prepare(program.sql).finalize();
    }
    const integrity = this.#database.exec({
      sql: "PRAGMA quick_check(1);",
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      throw new Error("PWA Library SQLite quick check failed");
    }
    this.#connectionGeneration += 1;
    return this.status();
  }

  status(): LibraryCoreSqliteWorkerStatus {
    if (this.#connectionGeneration === 0) {
      throw new Error("PWA Library SQLite is not initialized");
    }
    return Object.freeze({
      connectionGeneration: this.#connectionGeneration,
      contractVersion: LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
      engine: "sqlite-wasm-opfs-sahpool",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      schemaSha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
      schemaVersion: LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
      sqliteVersion: this.#sqliteVersion,
      storage: "opfs",
    });
  }

  describeNormalizedCheckpointExport(): LibraryCoreNormalizedCheckpointExportDescriptorV2 {
    const unresolvedIntentCount = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*) FROM library_intent_transactions
              WHERE state IN ('pending', 'published');`,
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "unresolved checkpoint intent count",
    );
    if (unresolvedIntentCount !== 0) {
      throw new Error(
        "normalized checkpoint export has unresolved local intents",
      );
    }
    const authorityRows = this.#database.exec({
      sql: `SELECT meta.library_id, meta.authority_epoch, writer.actor_id,
                   meta.source_revision, epoch.checkpoint_frontier_digest
            FROM library_meta AS meta
            JOIN library_active_authority AS active
              ON active.active_key = 'active'
             AND active.library_id = meta.library_id
             AND active.epoch_id = meta.authority_epoch
            JOIN library_authority_epochs AS epoch
              ON epoch.epoch_id = active.epoch_id
            JOIN library_actors AS writer
              ON writer.authority_epoch_id = active.epoch_id
             AND writer.actor_kind = 'desktop'
             AND writer.retired_at IS NULL
            WHERE meta.singleton_id = 1
              AND (SELECT count(*) FROM library_actors AS candidate
                   WHERE candidate.authority_epoch_id = active.epoch_id
                     AND candidate.actor_kind = 'desktop'
                     AND candidate.retired_at IS NULL) = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (authorityRows.length !== 1) {
      throw new Error("normalized checkpoint authority is unavailable");
    }
    const [libraryValue, epochValue, writerValue, revisionValue, carriedValue] =
      authorityRows[0]!;
    const libraryId = text(libraryValue, "checkpoint Library identity");
    const authorityEpoch = text(epochValue, "checkpoint authority epoch");
    const writerId = text(writerValue, "checkpoint writer identity");
    const sourceRevision = safeInteger(
      revisionValue,
      "checkpoint source revision",
    );
    const carriedFrontier = text(carriedValue, "checkpoint carried frontier");
    if (
      !isLibraryCoreLowercaseHex64(libraryId) ||
      !isLibraryCoreLowercaseHex64(authorityEpoch) ||
      !isLibraryCoreLowercaseHex64(writerId) ||
      !isLibraryCoreLowercaseHex64(carriedFrontier) ||
      sourceRevision < 0
    ) {
      throw new Error("normalized checkpoint authority identity is invalid");
    }
    const digest = new LibraryCoreSha256().update(
      checkpointFrontierDigestPrefix,
    );
    const carriedBytes = textEncoder.encode(carriedFrontier);
    digest.update(lengthBytes(carriedBytes.byteLength));
    digest.update(carriedBytes);
    const actorRows = this.#database.exec({
      sql: `SELECT actor_id, accepted_counter, accepted_operation_id,
                   accepted_chain_digest
            FROM library_actors
            WHERE authority_epoch_id = ?1 AND retired_at IS NULL
            ORDER BY actor_id;`,
      bind: [authorityEpoch],
      rowMode: "array",
      returnValue: "resultRows",
    });
    for (const actorRow of actorRows) {
      const actorId = text(actorRow[0], "checkpoint actor identity");
      const acceptedCounter = safeInteger(
        actorRow[1],
        "checkpoint actor counter",
      );
      const acceptedOperationId = nullableText(
        actorRow[2],
        "checkpoint actor operation identity",
      );
      const acceptedChainDigest = text(
        actorRow[3],
        "checkpoint actor chain digest",
      );
      if (acceptedCounter < 0) {
        throw new Error("normalized checkpoint actor counter is invalid");
      }
      for (const value of [actorId, acceptedChainDigest]) {
        const encoded = textEncoder.encode(value);
        digest.update(lengthBytes(encoded.byteLength));
        digest.update(encoded);
      }
      digest.update(signedIntegerBytes(acceptedCounter));
      if (acceptedOperationId === null) {
        digest.update(Uint8Array.of(0));
      } else {
        const encoded = textEncoder.encode(acceptedOperationId);
        digest.update(Uint8Array.of(1));
        digest.update(lengthBytes(encoded.byteLength));
        digest.update(encoded);
      }
    }
    const recordCount = safeInteger(
      this.#database.exec({
        sql: "SELECT count(*) FROM library_checkpoint_export;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "checkpoint record count",
    );
    const itemCount = safeInteger(
      this.#database.exec({
        sql: "SELECT count(*) FROM library_feed_items;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "checkpoint item count",
    );
    return Object.freeze({
      authorityEpoch,
      causalFrontierDigest: digest.digestLowerHex(),
      format: LIBRARY_CORE_NORMALIZED_CHECKPOINT_EXPORT_FORMAT,
      libraryId,
      itemCount,
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      recordCount,
      sourceRevision,
      writerId,
    });
  }

  exportPinnedNormalizedCheckpointPage(
    input: LibraryCorePinnedNormalizedCheckpointExportRequestV2,
  ): LibraryCoreNormalizedCheckpointExportPageV2 {
    const { page: request, snapshot } = input;
    if (
      request.maximumRecords < 1 ||
      request.maximumRecords > LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS ||
      request.maximumResponseBytes < 1 ||
      request.maximumResponseBytes >
        LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES
    ) {
      throw new Error("normalized checkpoint export bounds are invalid");
    }
    const afterRegistryKey = request.after?.registryKey ?? "";
    const afterPrimaryKeyJson = request.after?.primaryKeyJson ?? "";
    this.#database.exec("BEGIN;");
    try {
      if (
        JSON.stringify(this.describeNormalizedCheckpointExport()) !==
        JSON.stringify(snapshot)
      ) {
        throw new Error("normalized checkpoint changed during export");
      }
      const rows = this.#database.exec({
        sql: `SELECT registry_key, primary_key_json, payload_json, chunk_bytes
              FROM library_checkpoint_export
              WHERE (?1 = '' OR registry_key > ?1
                     OR (registry_key = ?1 AND primary_key_json > ?2))
              ORDER BY registry_key, primary_key_json
              LIMIT ?3;`,
        bind: [
          afterRegistryKey,
          afterPrimaryKeyJson,
          request.maximumRecords + 1,
        ],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const records =
        [] as LibraryCoreNormalizedCheckpointExportPageV2["records"][number][];
      let canonicalRecordBytes = 0;
      let nextCursor = request.after;
      for (const row of rows.slice(0, request.maximumRecords)) {
        const registryKey = text(row[0], "checkpoint registry key");
        const primaryKeyJson = text(row[1], "checkpoint primary key JSON");
        const primaryKey = JSON.parse(
          primaryKeyJson,
        ) as LibraryCoreNormalizedCheckpointPrimaryKeyV2;
        const payload = JSON.parse(
          text(row[2], "checkpoint payload JSON"),
        ) as Record<string, LibraryCoreCanonicalValue>;
        if (row[3] !== null) {
          payload.bytesBase64 = encodeLibraryCoreCanonicalBase64(
            bytes(row[3], "checkpoint chunk bytes"),
          );
        }
        const record = createLibraryCoreNormalizedCheckpointRecordV2({
          payload,
          primaryKey,
          registryKey: registryKey as Parameters<
            typeof createLibraryCoreNormalizedCheckpointRecordV2
          >[0]["registryKey"],
        });
        const canonicalBytes =
          encodeLibraryCoreNormalizedCheckpointRecordV2(record).byteLength;
        const candidate = {
          canonicalRecordBytes: canonicalRecordBytes + canonicalBytes,
          done: false,
          nextCursor: { primaryKeyJson, registryKey },
          records: [...records, record],
        };
        if (
          textEncoder.encode(JSON.stringify(candidate)).byteLength >
          request.maximumResponseBytes
        ) {
          break;
        }
        records.push(record);
        canonicalRecordBytes += canonicalBytes;
        nextCursor = Object.freeze({ primaryKeyJson, registryKey });
      }
      const hasMore =
        this.#database.exec({
          sql: `SELECT 1 FROM library_checkpoint_export
              WHERE (?1 = '' OR registry_key > ?1
                     OR (registry_key = ?1 AND primary_key_json > ?2))
              LIMIT 1;`,
          bind: [
            nextCursor?.registryKey ?? "",
            nextCursor?.primaryKeyJson ?? "",
          ],
          rowMode: 0,
          returnValue: "resultRows",
        }).length > 0;
      if (records.length === 0 && hasMore) {
        throw new Error(
          "normalized checkpoint response bound cannot fit the next record",
        );
      }
      const result = Object.freeze({
        canonicalRecordBytes,
        done: !hasMore,
        nextCursor,
        records: Object.freeze(records),
      });
      if (
        textEncoder.encode(JSON.stringify(result)).byteLength >
        request.maximumResponseBytes
      ) {
        throw new Error(
          "normalized checkpoint response exceeded its exact byte bound",
        );
      }
      this.#database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  beginNormalizedCheckpointStage(
    input: LibraryCoreBeginNormalizedCheckpointStageV2,
  ): LibraryCoreNormalizedCheckpointStageStatusV2 {
    const stage = parseLibraryCoreBeginNormalizedCheckpointStageV2(input);
    this.#database.exec({
      sql: `INSERT OR IGNORE INTO library_checkpoint_stages
              (stage_id, library_id, authority_epoch, source_revision,
               expected_record_count, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6);`,
      bind: [
        stage.stageId,
        stage.libraryId,
        stage.authorityEpoch,
        stage.sourceRevision,
        stage.expectedRecordCount,
        stage.createdAt,
      ],
    });
    const matches = this.#database.exec({
      sql: `SELECT library_id = ?2 AND authority_epoch = ?3 AND source_revision = ?4
                   AND expected_record_count = ?5 AND created_at = ?6
            FROM library_checkpoint_stages WHERE stage_id = ?1;`,
      bind: [
        stage.stageId,
        stage.libraryId,
        stage.authorityEpoch,
        stage.sourceRevision,
        stage.expectedRecordCount,
        stage.createdAt,
      ],
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (
      matches.length !== 1 ||
      safeInteger(matches[0], "checkpoint stage replay") !== 1
    ) {
      throw new Error(
        "normalized checkpoint stage replay changed its identity",
      );
    }
    return this.#checkpointStageStatus(stage.stageId);
  }

  appendNormalizedCheckpointStagePage(
    input: LibraryCoreNormalizedCheckpointStagePageV2,
  ): LibraryCoreNormalizedCheckpointStageStatusV2 {
    const page = parseLibraryCoreNormalizedCheckpointStagePageV2(input);
    const records = page.records.map((record) => {
      const parsed = parseLibraryCoreNormalizedCheckpointRecordV2(record);
      const canonical = encodeLibraryCoreNormalizedCheckpointRecordV2(parsed);
      return {
        canonical,
        digest: new LibraryCoreSha256()
          .update(stagedRecordDigestPrefix)
          .update(canonical)
          .digestLowerHex(),
        primaryKey: encodeLibraryCoreCanonicalValue(parsed.primaryKey, {
          maximumBytes: 4_096,
        }),
        registryKey: parsed.registryKey,
      };
    });
    const pageBytes = records.reduce(
      (total, record) => total + record.canonical.byteLength,
      0,
    );
    assertLibraryCoreNormalizedCheckpointPageBytesV2(pageBytes);
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const expectedRows = this.#database.exec({
        sql: "SELECT expected_record_count FROM library_checkpoint_stages WHERE stage_id = ?1;",
        bind: [page.stageId],
        rowMode: 0,
        returnValue: "resultRows",
      });
      if (expectedRows.length !== 1) {
        throw new Error("normalized checkpoint stage does not exist");
      }
      const expectedRecordCount = safeInteger(
        expectedRows[0],
        "checkpoint expected record count",
      );
      for (const record of records) {
        this.#database.exec({
          sql: `INSERT OR IGNORE INTO library_checkpoint_stage_records
                  (stage_id, registry_key, primary_key_canonical, record_canonical, record_digest)
                VALUES (?1, ?2, ?3, ?4, ?5);`,
          bind: [
            page.stageId,
            record.registryKey,
            record.primaryKey,
            record.canonical,
            record.digest,
          ],
        });
        const replay = this.#database.exec({
          sql: `SELECT record_digest = ?4 AND record_canonical = ?5
                FROM library_checkpoint_stage_records
                WHERE stage_id = ?1 AND registry_key = ?2 AND primary_key_canonical = ?3;`,
          bind: [
            page.stageId,
            record.registryKey,
            record.primaryKey,
            record.digest,
            record.canonical,
          ],
          rowMode: 0,
          returnValue: "resultRows",
        });
        if (
          replay.length !== 1 ||
          safeInteger(replay[0], "checkpoint record replay") !== 1
        ) {
          throw new Error(
            "normalized checkpoint record replay changed its bytes",
          );
        }
      }
      const totals = this.#database.exec({
        sql: `SELECT count(*), coalesce(sum(length(record_canonical)), 0)
              FROM library_checkpoint_stage_records WHERE stage_id = ?1;`,
        bind: [page.stageId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const stagedRecordCount = safeInteger(
        totals[0]?.[0],
        "staged record count",
      );
      const stagedCanonicalBytes = safeInteger(
        totals[0]?.[1],
        "staged canonical bytes",
      );
      if (stagedRecordCount > expectedRecordCount) {
        throw new Error(
          "normalized checkpoint stage exceeds its expected record count",
        );
      }
      this.#database.exec({
        sql: `UPDATE library_checkpoint_stages
              SET staged_record_count = ?2, staged_canonical_bytes = ?3
              WHERE stage_id = ?1;`,
        bind: [page.stageId, stagedRecordCount, stagedCanonicalBytes],
      });
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
    return this.#checkpointStageStatus(page.stageId);
  }

  async verifyNormalizedCheckpointActorRetirements(
    stageId: string,
  ): Promise<void> {
    if (
      typeof stageId !== "string" ||
      stageId.length === 0 ||
      stageId.length > 255
    ) {
      throw new Error("normalized checkpoint stage identity is invalid");
    }
    const statement = this.#database.prepare(
      `SELECT record_canonical FROM library_checkpoint_stage_records
       WHERE stage_id = ?1 AND registry_key IN ('01_authority_epoch', '93_actor_retirement')
       ORDER BY registry_key, primary_key_canonical;`,
    );
    const authorities = new Map<string, Record<string, unknown>>();
    const retirements: Array<{
      readonly primaryKey: unknown;
      readonly payload: Record<string, unknown>;
    }> = [];
    try {
      statement.bind([stageId]);
      while (statement.step()) {
        const canonical = Uint8Array.from(
          statement.getBlob(0) ??
            (() => {
              throw new Error(
                "normalized checkpoint retirement record is missing",
              );
            })(),
        );
        const record = parseLibraryCoreNormalizedCheckpointRecordV2(
          decodeLibraryCoreCanonicalValue(canonical, {
            maximumBytes:
              LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
          }),
        );
        const payload = record.payload as Record<string, unknown>;
        if (record.registryKey === "01_authority_epoch") {
          if (typeof record.primaryKey !== "string") {
            throw new Error(
              "checkpoint retirement authority identity is invalid",
            );
          }
          authorities.set(record.primaryKey, payload);
        } else if (record.registryKey === "93_actor_retirement") {
          retirements.push({ primaryKey: record.primaryKey, payload });
        }
      }
    } finally {
      statement.finalize();
    }
    for (const retirement of retirements) {
      const epochId = text(
        retirement.payload.authorityEpochId,
        "checkpoint retirement authority epoch",
      );
      const authority = authorities.get(epochId);
      if (!authority) {
        throw new Error("checkpoint retirement authority is missing");
      }
      const canonicalCertificateText = text(
        retirement.payload.canonicalCertificate,
        "checkpoint retirement certificate",
      );
      let certificateValue: LibraryCoreCanonicalValue;
      try {
        certificateValue = JSON.parse(
          canonicalCertificateText,
        ) as LibraryCoreCanonicalValue;
      } catch {
        throw new Error("checkpoint retirement certificate is not JSON");
      }
      const canonicalCertificate = encodeLibraryCoreCanonicalValue(
        certificateValue,
        { maximumBytes: 65_536 },
      );
      if (
        new TextDecoder().decode(canonicalCertificate) !==
        canonicalCertificateText
      ) {
        throw new Error("checkpoint retirement certificate is not canonical");
      }
      const verified = await verifyLibraryCoreActorRetirementCertificateV1(
        canonicalCertificate,
        {
          library_id: text(
            authority.libraryId,
            "checkpoint retirement Library identity",
          ),
          epoch: safeInteger(
            authority.epochNumber,
            "checkpoint retirement epoch number",
          ),
          epoch_id: epochId,
          authority_key_id: text(
            authority.authorityKeyId,
            "checkpoint retirement authority key identity",
          ),
          authority_public_key: text(
            authority.authorityPublicKey,
            "checkpoint retirement authority public key",
          ),
        } as never,
        {
          digest: coreDigest,
          verifySignature: verifyLibraryCoreEd25519WithWebCrypto,
        },
      );
      const body = verified.certificate.retirement_body;
      if (
        retirement.primaryKey !== body.retirement_identity ||
        retirement.payload.actorId !== body.actor_id ||
        retirement.payload.capabilityId !== body.capability_id ||
        retirement.payload.capabilityCertificateDigest !==
          body.capability_certificate_digest ||
        retirement.payload.certificateDigest !==
          verified.certificate.certificate_digest ||
        retirement.payload.reason !== body.reason ||
        retirement.payload.retiredAt !== body.retired_at_ms
      ) {
        throw new Error("checkpoint retirement certificate changed");
      }
    }
  }

  activateNormalizedCheckpointStage(
    input: LibraryCoreActivateNormalizedCheckpointStageV2,
  ): LibraryCoreNormalizedCheckpointActivationReceiptV2 {
    const activation =
      parseLibraryCoreActivateNormalizedCheckpointStageV2(input);
    const { followerReceipt, replaceExisting, stageId } = activation;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database.exec("PRAGMA defer_foreign_keys = ON;");
      const stages = this.#database.exec({
        sql: `SELECT library_id, authority_epoch, source_revision,
                     expected_record_count, staged_canonical_bytes
              FROM library_checkpoint_stages
              WHERE stage_id = ?1 AND staged_record_count = expected_record_count;`,
        bind: [stageId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (stages.length !== 1) {
        throw new Error("normalized checkpoint stage is incomplete");
      }
      const stage = stages[0]!;
      const libraryId = text(stage[0], "checkpoint Library identity");
      const authorityEpoch = text(stage[1], "checkpoint authority epoch");
      const sourceRevision = safeInteger(
        stage[2],
        "checkpoint source revision",
      );
      const expectedRecordCount = safeInteger(
        stage[3],
        "checkpoint expected record count",
      );
      const canonicalBytes = safeInteger(
        stage[4],
        "checkpoint canonical bytes",
      );
      if (replaceExisting) {
        const unresolvedLocalOperations = safeInteger(
          this.#database.exec({
            sql: `SELECT
                    (SELECT count(*) FROM library_intent_transactions
                       WHERE state IN ('pending', 'published')) +
                    (SELECT count(*) FROM library_optimistic_fields) +
                    (SELECT count(*) FROM library_replication_outbox
                       WHERE acknowledged_at IS NULL) +
                    (SELECT count(*) FROM library_follower_result_outbox
                       WHERE acknowledged_at IS NULL) +
                    (SELECT count(*) FROM library_primary_intent_stage_transactions);`,
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "checkpoint replacement unresolved operation count",
        );
        if (unresolvedLocalOperations !== 0) {
          throw new Error(
            "normalized checkpoint replacement has unresolved local operations",
          );
        }
        this.#database.exec(`DELETE FROM library_optimistic_fields;
          DELETE FROM library_local_invalidations;
          DELETE FROM library_intent_results;
          DELETE FROM library_intent_result_cursors;
          DELETE FROM library_intent_members;
          DELETE FROM library_intent_transactions;
          DELETE FROM library_intent_actors;
          DELETE FROM library_primary_intent_stage_members;
          DELETE FROM library_primary_intent_stage_transactions;
          DELETE FROM library_follower_result_outbox;
          DELETE FROM library_follower_result_cursors;
          DELETE FROM library_operation_replication_stage_members;
          DELETE FROM library_operation_replication_stages;
          DELETE FROM library_operation_replication_results;
          DELETE FROM library_replication_outbox;
          DELETE FROM library_operation_causal_tips;
          DELETE FROM library_operations;
          DELETE FROM library_transactions;
          DELETE FROM library_invalidations;
          DELETE FROM library_follower_checkpoint_receipt;
          DELETE FROM library_device_scope_action_members;
          DELETE FROM library_device_scope_actions;
          DELETE FROM library_device_person_graph_layout;
          DELETE FROM library_device_account_graph_layout;
          DELETE FROM library_person_feed_items;
          DELETE FROM library_relationships;
          DELETE FROM library_field_clocks;
          DELETE FROM library_tombstones;
          DELETE FROM library_receipts;
          DELETE FROM library_feed_items;
          DELETE FROM library_rss_feeds;
          DELETE FROM library_account_follow_roles;
          DELETE FROM library_accounts;
          DELETE FROM library_person_reach_outs;
          DELETE FROM library_person_tags;
          DELETE FROM library_persons;
          DELETE FROM library_preferences;
          DELETE FROM library_actor_retirements;
          DELETE FROM library_actor_capability_queries;
          DELETE FROM library_actor_capability_mutations;
          DELETE FROM library_actor_capabilities;
          DELETE FROM library_actors;
          DELETE FROM library_active_authority;
          DELETE FROM library_authority_frontier;
          DELETE FROM library_authority_epochs;
          DELETE FROM library_blob_chunks;
          DELETE FROM library_content_ranges;
          DELETE FROM library_blobs;
          DELETE FROM library_materialization_generation;
          DELETE FROM library_meta;
          DELETE FROM library_storage_transition_plan;
          DELETE FROM library_saved_platform_counts;
          DELETE FROM library_tag_counts;
          UPDATE library_facet_summary SET total_count = 0, archived_count = 0,
            sample_item_count = 0, saved_count = 0, saved_archived_count = 0
            WHERE singleton_id = 1;
          UPDATE library_device_graph_layout_state SET revision = 0
            WHERE singleton_id = 1;
          UPDATE library_change_state SET revision = 0 WHERE singleton_id = 1;
          UPDATE library_local_change_state SET sequence = 0 WHERE singleton_id = 1;`);
      }
      const existingRows = safeInteger(
        this.#database.exec({
          sql: `SELECT sum(row_count) FROM (
                  SELECT count(*) AS row_count FROM library_meta
                  UNION ALL SELECT count(*) FROM library_materialization_generation
                  UNION ALL SELECT count(*) FROM library_authority_epochs
                  UNION ALL SELECT count(*) FROM library_authority_frontier
                  UNION ALL SELECT count(*) FROM library_active_authority
                  UNION ALL SELECT count(*) FROM library_feed_items
                  UNION ALL SELECT count(*) FROM library_rss_feeds
                  UNION ALL SELECT count(*) FROM library_persons
                  UNION ALL SELECT count(*) FROM library_accounts
                  UNION ALL SELECT count(*) FROM library_preferences
                  UNION ALL SELECT count(*) FROM library_relationships
                  UNION ALL SELECT count(*) FROM library_field_clocks
                  UNION ALL SELECT count(*) FROM library_tombstones
                  UNION ALL SELECT count(*) FROM library_actors
                  UNION ALL SELECT count(*) FROM library_actor_capabilities
                  UNION ALL SELECT count(*) FROM library_actor_capability_mutations
                  UNION ALL SELECT count(*) FROM library_actor_capability_queries
                  UNION ALL SELECT count(*) FROM library_actor_retirements
                  UNION ALL SELECT count(*) FROM library_receipts
                  UNION ALL SELECT count(*) FROM library_blobs
                  UNION ALL SELECT count(*) FROM library_content_ranges
                  UNION ALL SELECT count(*) FROM library_transactions
                  UNION ALL SELECT count(*) FROM library_invalidations
                  UNION ALL SELECT count(*) FROM library_intent_transactions
                );`,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "checkpoint activation target rows",
      );
      if (existingRows !== 0) {
        throw new Error("normalized checkpoint activation target is not empty");
      }
      const digest = new LibraryCoreSha256().update(checkpointDigestPrefix);
      const statement = this.#database.prepare(
        `SELECT record_canonical FROM library_checkpoint_stage_records
         WHERE stage_id = ?1 ORDER BY registry_key, primary_key_canonical;`,
      );
      let recordCount = 0;
      try {
        statement.bind([stageId]);
        while (statement.step()) {
          const canonical = Uint8Array.from(
            statement.getBlob(0) ??
              (() => {
                throw new Error(
                  "normalized checkpoint canonical record is missing",
                );
              })(),
          );
          digest.update(lengthBytes(canonical.byteLength));
          digest.update(canonical);
          const record = parseLibraryCoreNormalizedCheckpointRecordV2(
            decodeLibraryCoreCanonicalValue(canonical, {
              maximumBytes:
                LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
            }),
          );
          if (record.registryKey === "00_checkpoint_header") {
            validateCheckpointHeader(record);
          }
          const program =
            LIBRARY_CORE_SQLITE_CHECKPOINT_IMPORT_PROGRAMS[record.registryKey];
          const primaryKeyJson = JSON.stringify(record.primaryKey);
          const payloadJson = JSON.stringify(
            libraryCoreNormalizedCheckpointSqlitePayloadV2(record),
          );
          const bind: SqlValue[] = [primaryKeyJson, payloadJson];
          if (program.hasChunkBytes) {
            bind.push(decodeLibraryCoreContentChunkBytesV1(record));
          }
          this.#database.exec({ sql: program.sql, bind });
          const changes = safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "checkpoint import changes",
          );
          if (changes !== 1) {
            throw new Error(
              "checkpoint payload identity does not match its primary key",
            );
          }
          recordCount += 1;
        }
      } finally {
        statement.finalize();
      }
      const checkpointDigest = digest.digestLowerHex();
      if (recordCount !== expectedRecordCount) {
        throw new Error(
          "normalized checkpoint record count does not match its stage",
        );
      }
      const meta = this.#database.exec({
        sql: `SELECT library_id = ?1 AND authority_epoch = ?2 AND source_revision = ?3
              FROM library_meta WHERE singleton_id = 1;`,
        bind: [libraryId, authorityEpoch, sourceRevision],
        rowMode: 0,
        returnValue: "resultRows",
      });
      if (
        meta.length !== 1 ||
        safeInteger(meta[0], "checkpoint header match") !== 1
      ) {
        throw new Error("checkpoint header does not match its stage identity");
      }
      this.#database.exec({
        sql: `INSERT INTO library_materialization_generation
                (singleton_id, generation_id) VALUES (1, ?1);`,
        bind: [checkpointDigest],
      });
      this.#database.exec({
        sql: `UPDATE library_change_state SET revision = ?1
              WHERE singleton_id = 1 AND revision = 0;`,
        bind: [sourceRevision],
      });
      if (
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "checkpoint change revision activation",
        ) !== 1
      ) {
        throw new Error("checkpoint change revision could not be activated");
      }
      if (sourceRevision > 0) {
        this.#database.exec({
          sql: `INSERT INTO library_invalidations
                  (revision, ordinal, topic, entity_id, reset_required)
                VALUES (?1, 0, 'library', NULL, 1);`,
          bind: [sourceRevision],
        });
      }
      this.#verifyCheckpointContent();
      this.#reconcileLocalContentState();
      const foreignKeys = this.#database.exec({
        sql: "PRAGMA foreign_key_check;",
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (foreignKeys.length !== 0) {
        throw new Error(
          "normalized checkpoint has an unresolved foreign reference",
        );
      }
      this.#verifyCheckpointAuthority(libraryId, authorityEpoch);
      if (followerReceipt !== null) {
        const writerMatches = safeInteger(
          this.#database.exec({
            sql: `SELECT count(*)
                  FROM library_active_authority AS active
                  JOIN library_actors AS actor
                    ON actor.authority_epoch_id = active.epoch_id
                   AND actor.actor_kind = 'desktop' AND actor.retired_at IS NULL
                  WHERE active.active_key = 'active' AND active.library_id = ?1
                    AND active.epoch_id = ?2 AND actor.actor_id = ?3;`,
            bind: [libraryId, authorityEpoch, followerReceipt.writerActorId],
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "checkpoint active writer match count",
        );
        if (writerMatches !== 1) {
          throw new Error(
            "normalized follower checkpoint writer is not active",
          );
        }
        this.#database.exec({
          sql: `INSERT INTO library_follower_checkpoint_receipt
                  (singleton_id, library_id, authority_epoch_id, writer_actor_id,
                   checkpoint_generation, source_revision, checkpoint_digest,
                   manifest_object_key, manifest_transport_object_id,
                   manifest_content_digest, control_revision, installed_at)
                VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);`,
          bind: [
            libraryId,
            authorityEpoch,
            followerReceipt.writerActorId,
            followerReceipt.checkpointGeneration,
            sourceRevision,
            checkpointDigest,
            followerReceipt.manifestObjectKey,
            followerReceipt.manifestTransportObjectId,
            followerReceipt.manifestContentDigest,
            followerReceipt.controlRevision,
            followerReceipt.installedAt,
          ],
        });
        const localActors = this.#database.exec({
          sql: `SELECT actor_id FROM library_follower_actor_request
                WHERE singleton_id = 1 AND library_id = ?1
                  AND authority_epoch_id = ?2
                  AND enrollment_certificate_digest IS NOT NULL;`,
          bind: [libraryId, authorityEpoch],
          rowMode: 0,
          returnValue: "resultRows",
        });
        if (localActors.length === 1) {
          const actorId = text(localActors[0], "local follower actor identity");
          const actorTips = this.#database.exec({
            sql: `SELECT accepted_counter, accepted_operation_id,
                         accepted_chain_digest
                  FROM library_actors
                  WHERE actor_id = ?1 AND authority_epoch_id = ?2
                    AND retired_at IS NULL;`,
            bind: [actorId, authorityEpoch],
            rowMode: "array",
            returnValue: "resultRows",
          });
          if (actorTips.length !== 1) {
            throw new Error(
              "normalized checkpoint omits the enrolled local follower actor",
            );
          }
          const acceptedCounter = safeInteger(
            actorTips[0]![0],
            "local follower actor accepted counter",
          );
          if (acceptedCounter >= Number.MAX_SAFE_INTEGER) {
            throw new Error("normalized follower actor counter is invalid");
          }
          this.#database.exec({
            sql: `INSERT INTO library_intent_actors
                    (actor_id, next_counter, previous_operation_id,
                     previous_chain_digest) VALUES (?1, ?2, ?3, ?4);`,
            bind: [
              actorId,
              acceptedCounter + 1,
              actorTips[0]![1],
              actorTips[0]![2],
            ],
          });
        } else if (localActors.length > 1) {
          throw new Error("normalized follower actor request is ambiguous");
        }
      }
      this.#database.exec({
        sql: "DELETE FROM library_checkpoint_stages WHERE stage_id = ?1;",
        bind: [stageId],
      });
      this.#database.exec("COMMIT;");
      return Object.freeze({
        authorityEpoch,
        canonicalBytes,
        checkpointDigest,
        libraryId,
        recordCount,
        sourceRevision,
        stageId,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #reconcileLocalContentState(changedBefore = false): void {
    const before = safeInteger(
      this.#database.exec({
        sql: "SELECT total_changes();",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "content reconciliation starting change count",
    );
    this.#database.exec(
      LIBRARY_CORE_SQLITE_LOCAL_RECONCILIATION_PROGRAMS.content_checkpoint_reconcile_v1,
    );
    const after = safeInteger(
      this.#database.exec({
        sql: "SELECT total_changes();",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "content reconciliation ending change count",
    );
    if (changedBefore || after > before) {
      this.#database.exec(`UPDATE library_device_content_state
        SET revision = revision + 1
        WHERE singleton_id = 1 AND revision < 9007199254740991;`);
      const advanced = safeInteger(
        this.#database.exec({
          sql: "SELECT changes();",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "content reconciliation revision row count",
      );
      if (advanced !== 1) {
        throw new Error("selective content revision cannot advance");
      }
    }
  }

  readNormalizedCheckpointReceipt(): LibraryCoreNormalizedCheckpointSelectionV2 {
    const rows = this.#database.exec({
      sql: `SELECT authority_epoch_id, checkpoint_digest,
                   checkpoint_generation, control_revision, installed_at,
                   library_id, manifest_content_digest, manifest_object_key,
                   manifest_transport_object_id, source_revision,
                   writer_actor_id
            FROM library_follower_checkpoint_receipt
            WHERE singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length === 0) return Object.freeze({ receipt: null });
    if (rows.length !== 1) {
      throw new Error("normalized checkpoint receipt is ambiguous");
    }
    const row = rows[0]!;
    return parseLibraryCoreNormalizedCheckpointSelectionV2({
      receipt: Object.freeze({
        authorityEpoch: text(row[0], "checkpoint receipt authority epoch"),
        checkpointDigest: text(row[1], "checkpoint receipt digest"),
        checkpointGeneration: safeInteger(
          row[2],
          "checkpoint receipt generation",
        ),
        controlRevision: text(row[3], "checkpoint control revision"),
        installedAt: safeInteger(row[4], "checkpoint installation time"),
        libraryId: text(row[5], "checkpoint receipt Library identity"),
        manifestContentDigest: text(
          row[6],
          "checkpoint manifest content digest",
        ),
        manifestObjectKey: text(row[7], "checkpoint manifest object key"),
        manifestTransportObjectId: text(
          row[8],
          "checkpoint manifest transport object identity",
        ),
        sourceRevision: safeInteger(row[9], "checkpoint source revision"),
        writerActorId: text(row[10], "checkpoint writer actor identity"),
      }),
    });
  }

  mutateDeviceGraphLayout(
    input: LibraryCoreDeviceGraphLayoutMutationV1,
  ): LibraryCoreDeviceGraphLayoutMutationResultV1 {
    const parsed = parseLibraryCoreDeviceGraphLayoutMutationV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const mutation = parsed.value;
    const program =
      LIBRARY_CORE_SQLITE_LOCAL_MUTATION_PROGRAMS[mutation.mutationId];
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const targetExists = safeInteger(
        this.#database.exec({
          sql: program.targetExistsSql,
          bind: [mutation.entityId],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "device graph layout target existence",
      );
      if (targetExists !== 1) {
        throw new Error("device graph layout target is unavailable");
      }
      this.#database.exec({
        sql: program.sql,
        bind:
          "graphX" in mutation
            ? [
                mutation.entityId,
                mutation.graphX,
                mutation.graphY,
                mutation.updatedAt,
              ]
            : [mutation.entityId],
      });
      const changed = safeInteger(
        this.#database.exec({
          sql: "SELECT changes();",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "device graph layout mutation row count",
      );
      if (changed > program.maximumRows) {
        throw new Error("device graph layout mutation exceeded its row bound");
      }
      if (changed === 1) {
        this.#database.exec({
          sql: `UPDATE library_device_graph_layout_state
                SET revision = revision + 1
                WHERE singleton_id = 1 AND revision < 9007199254740991;`,
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "device graph layout revision change",
          ) !== 1
        ) {
          throw new Error("device graph layout revision cannot advance");
        }
      }
      const layoutRevision = safeInteger(
        this.#database.exec({
          sql: "SELECT revision FROM library_device_graph_layout_state WHERE singleton_id = 1;",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "device graph layout revision",
      );
      const result = parseLibraryCoreDeviceGraphLayoutMutationResultV1({
        changed: changed === 1,
        layoutRevision,
        mutationId: mutation.mutationId,
        schemaVersion: 1,
      });
      if (!result.ok) throw new Error(result.error);
      this.#database.exec("COMMIT;");
      return result.value;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  queryDeviceContacts(
    input: LibraryCoreDeviceContactQueryRequestV1,
  ): LibraryCoreDeviceContactQueryResponseV1 {
    const parsed = parseLibraryCoreDeviceContactQueryRequestV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    if (request.queryId === "device_contact_status_v1") {
      const rows = this.#database.exec({
        sql: `SELECT state.revision, state.active_generation_id, state.auth_status,
                     state.sync_status, state.sync_started_at, state.sync_token,
                     state.last_synced_at, state.last_error_code, state.last_error_message,
                     (SELECT count(*) FROM library_accounts AS account
                      WHERE account.kind = 'contact' COLLATE BINARY
                        AND account.provider = 'google_contacts' COLLATE BINARY
                        AND account.person_id IS NOT NULL),
                     state.updated_at,
                     CASE WHEN state.active_generation_id IS NULL THEN 0 ELSE
                       (SELECT count(*) FROM library_device_contacts WHERE generation_id = state.active_generation_id AND deleted = 0) END,
                     CASE WHEN state.active_generation_id IS NULL THEN 0 ELSE
                       (SELECT count(*) FROM library_device_contact_suggestions WHERE generation_id = state.active_generation_id AND dismissed_at IS NULL) END
              FROM library_device_contact_sync_state AS state WHERE singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (rows.length !== 1)
        throw new Error("device contact status is unavailable");
      const row = rows[0]!;
      const response = parseLibraryCoreDeviceContactQueryResponseV1(
        {
          activeContactCount: safeInteger(
            row[11],
            "device contact active count",
          ),
          activeGenerationId: nullableText(
            row[1],
            "device contact active generation",
          ),
          authStatus: text(row[2], "device contact auth status"),
          createdFriendCount: safeInteger(
            row[9],
            "device contact friend count",
          ),
          lastErrorCode: nullableText(row[7], "device contact error code"),
          lastErrorMessage: nullableText(
            row[8],
            "device contact error message",
          ),
          lastSyncedAt: nullableInteger(row[6], "device contact last synced"),
          pendingSuggestionCount: safeInteger(
            row[12],
            "device contact suggestion count",
          ),
          queryId: request.queryId,
          revision: safeInteger(row[0], "device contact revision"),
          schemaVersion: 1,
          syncStartedAt: nullableInteger(row[4], "device contact sync started"),
          syncStatus: text(row[3], "device contact sync status"),
          syncToken: nullableText(row[5], "device contact sync token"),
          updatedAt: safeInteger(row[10], "device contact updated time"),
        },
        request,
      );
      if (!response.ok) throw new Error(response.error);
      return response.value;
    }
    const state = this.#database.exec({
      sql: `SELECT active_generation_id, revision FROM library_device_contact_sync_state WHERE singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (state.length !== 1)
      throw new Error("device contact state is unavailable");
    const revision = safeInteger(state[0]![1], "device contact revision");
    const maximumBytes = LIBRARY_CORE_DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES;
    const encodedBytes = (value: unknown) =>
      encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue, {
        maximumBytes,
      }).byteLength + 1;
    if (request.queryId === "device_contact_match_page_v1") {
      const generationState = this.#database.exec({
        sql: `SELECT state FROM library_device_contact_generations WHERE generation_id = ?1 COLLATE BINARY;`,
        bind: [request.generationId],
        rowMode: 0,
        returnValue: "resultRows",
      });
      if (generationState[0] !== "building")
        throw new Error("device contact generation is not building");
      const identities = this.#database
        .exec({
          sql: `SELECT contact.resource_name FROM library_device_contacts AS contact
              WHERE contact.generation_id = ?1 COLLATE BINARY AND contact.deleted = 0
                AND (?2 IS NULL OR contact.resource_name > ?2 COLLATE BINARY)
                AND NOT EXISTS (SELECT 1 FROM library_device_contact_match_receipts AS receipt
                  WHERE receipt.generation_id = contact.generation_id AND receipt.resource_name = contact.resource_name)
              ORDER BY contact.resource_name COLLATE BINARY LIMIT ?3;`,
          bind: [
            request.generationId,
            request.afterResourceName,
            request.limit + 1,
          ],
          rowMode: 0,
          returnValue: "resultRows",
        })
        .map((value) => text(value, "device contact match identity"));
      const rows = [];
      let bytes = 16_384;
      for (const identity of identities.slice(0, request.limit)) {
        const contact = deviceContactFromDatabase(
          this.#database,
          request.generationId,
          identity,
        );
        const contactBytes = encodedBytes(contact);
        if (bytes + contactBytes > maximumBytes) break;
        bytes += contactBytes;
        rows.push(contact);
      }
      const response = parseLibraryCoreDeviceContactQueryResponseV1(
        {
          generationId: request.generationId,
          nextCursor:
            rows.length < identities.length
              ? (rows.at(-1)?.resourceName ?? null)
              : null,
          queryId: request.queryId,
          revision,
          rows,
          schemaVersion: 1,
        },
        request,
      );
      if (!response.ok) throw new Error(response.error);
      return response.value;
    }
    const generationId = nullableText(
      state[0]![0],
      "device contact active generation",
    );
    if (generationId === null)
      throw new Error("device contact generation is unavailable");
    if (request.queryId === "device_contact_suggestion_page_v1") {
      const rank =
        request.cursor === null
          ? null
          : request.cursor.confidence === "high"
            ? 0
            : 1;
      const candidates = this.#database.exec({
        sql: `SELECT suggestion_id, resource_name, kind, confidence, person_id, label, reason, created_at
              FROM library_device_contact_suggestions WHERE generation_id = ?1 COLLATE BINARY AND dismissed_at IS NULL
                AND (?2 IS NULL OR CASE confidence WHEN 'high' THEN 0 ELSE 1 END > ?2
                  OR (CASE confidence WHEN 'high' THEN 0 ELSE 1 END = ?2 AND created_at < ?3)
                  OR (CASE confidence WHEN 'high' THEN 0 ELSE 1 END = ?2 AND created_at = ?3 AND suggestion_id > ?4 COLLATE BINARY))
              ORDER BY CASE confidence WHEN 'high' THEN 0 ELSE 1 END, created_at DESC, suggestion_id COLLATE BINARY LIMIT ?5;`,
        bind: [
          generationId,
          rank,
          request.cursor?.createdAt ?? null,
          request.cursor?.suggestionId ?? null,
          request.limit + 1,
        ],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const rows = [];
      let bytes = 16_384;
      for (const candidate of candidates.slice(0, request.limit)) {
        const suggestionId = text(
          candidate[0],
          "device contact suggestion identity",
        );
        const accountIds = this.#database
          .exec({
            sql: `SELECT account_id FROM library_device_contact_suggestion_accounts WHERE generation_id = ?1 COLLATE BINARY AND suggestion_id = ?2 COLLATE BINARY ORDER BY ordinal;`,
            bind: [generationId, suggestionId],
            rowMode: 0,
            returnValue: "resultRows",
          })
          .map((value) => text(value, "device contact suggestion account"));
        const row = {
          contact: deviceContactFromDatabase(
            this.#database,
            generationId,
            text(candidate[1], "device contact suggestion resource"),
          ),
          suggestion: {
            accountIds,
            confidence: text(
              candidate[3],
              "device contact suggestion confidence",
            ),
            createdAt: safeInteger(
              candidate[7],
              "device contact suggestion created time",
            ),
            id: suggestionId,
            kind: text(candidate[2], "device contact suggestion kind"),
            label: text(candidate[5], "device contact suggestion label"),
            ...(candidate[4] === null
              ? {}
              : {
                  personId: text(
                    candidate[4],
                    "device contact suggestion person",
                  ),
                }),
            ...(candidate[6] === null
              ? {}
              : {
                  reason: text(
                    candidate[6],
                    "device contact suggestion reason",
                  ),
                }),
          },
        };
        if (bytes + encodedBytes(row) > maximumBytes) break;
        bytes += encodedBytes(row);
        rows.push(row);
      }
      const last = rows.at(-1)?.suggestion;
      const response = parseLibraryCoreDeviceContactQueryResponseV1(
        {
          nextCursor:
            rows.length < candidates.length && last
              ? {
                  confidence: last.confidence,
                  createdAt: last.createdAt,
                  suggestionId: last.id,
                }
              : null,
          queryId: request.queryId,
          revision,
          rows,
          schemaVersion: 1,
        },
        request,
      );
      if (!response.ok) throw new Error(response.error);
      return response.value;
    }
    const candidates = this.#database.exec({
      sql: `SELECT COALESCE(contact.display_name, ''), contact.resource_name FROM library_device_contacts AS contact
            WHERE contact.generation_id = ?1 COLLATE BINARY AND contact.deleted = 0
              AND EXISTS (SELECT 1 FROM library_device_contact_match_receipts AS receipt WHERE receipt.generation_id = contact.generation_id AND receipt.resource_name = contact.resource_name)
              AND NOT EXISTS (SELECT 1 FROM library_device_contact_suggestions AS suggestion WHERE suggestion.generation_id = contact.generation_id AND suggestion.resource_name = contact.resource_name)
              AND NOT EXISTS (SELECT 1 FROM library_accounts AS account WHERE account.provider = 'google_contacts' COLLATE BINARY AND account.external_id = contact.resource_name COLLATE BINARY)
              AND (?2 IS NULL OR COALESCE(contact.display_name, '') > ?2 COLLATE BINARY OR (COALESCE(contact.display_name, '') = ?2 COLLATE BINARY AND contact.resource_name > ?3 COLLATE BINARY))
            ORDER BY COALESCE(contact.display_name, '') COLLATE BINARY, contact.resource_name COLLATE BINARY LIMIT ?4;`,
      bind: [
        generationId,
        request.cursor?.displayName ?? null,
        request.cursor?.resourceName ?? null,
        request.limit + 1,
      ],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const rows = [];
    let bytes = 16_384;
    for (const candidate of candidates.slice(0, request.limit)) {
      const contact = deviceContactFromDatabase(
        this.#database,
        generationId,
        text(candidate[1], "device contact unmatched identity"),
      );
      const contactBytes = encodedBytes(contact);
      if (bytes + contactBytes > maximumBytes) break;
      bytes += contactBytes;
      rows.push(contact);
    }
    const last = rows.at(-1);
    const response = parseLibraryCoreDeviceContactQueryResponseV1(
      {
        nextCursor:
          rows.length < candidates.length && last
            ? {
                displayName: last.name.displayName ?? "",
                resourceName: last.resourceName,
              }
            : null,
        queryId: request.queryId,
        revision,
        rows,
        schemaVersion: 1,
      },
      request,
    );
    if (!response.ok) throw new Error(response.error);
    return response.value;
  }

  mutateDeviceContactSync(
    input: LibraryCoreDeviceContactSyncMutationV1,
  ): LibraryCoreDeviceContactMutationReceiptV1 {
    const parsed = parseLibraryCoreDeviceContactSyncMutationV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const mutation = parsed.value;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      let changed = false;
      if (mutation.mutationKind === "device_contact_generation_begin_v1") {
        const buildingRows = this.#database.exec({
          sql: `SELECT generation_id
                FROM library_device_contact_generations
                WHERE state = 'building';`,
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (buildingRows.length > 1) {
          throw new Error("device contact building generation is ambiguous");
        }
        if (buildingRows.length === 1) {
          if (
            text(buildingRows[0]![0], "building device contact generation") !==
            mutation.generationId
          ) {
            const syncStatus = text(
              this.#database.exec({
                sql: `SELECT sync_status FROM library_device_contact_sync_state
                      WHERE singleton_id = 1;`,
                rowMode: 0,
                returnValue: "resultRows",
              })[0],
              "device contact sync status",
            );
            if (syncStatus === "syncing") {
              throw new Error("another device contact generation is building");
            }
            this.#database.exec({
              sql: `DELETE FROM library_device_contact_generations
                    WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';`,
              bind: [
                text(buildingRows[0]![0], "building device contact generation"),
              ],
            });
            buildingRows.length = 0;
          }
        }
        if (buildingRows.length === 0) {
          const activeGeneration = nullableText(
            this.#database.exec({
              sql: `SELECT active_generation_id
                    FROM library_device_contact_sync_state
                    WHERE singleton_id = 1;`,
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "active device contact generation",
          );
          this.#database.exec({
            sql: `INSERT INTO library_device_contact_generations
                    (generation_id, state, expected_contact_count,
                     staged_contact_count, matched_contact_count, created_at,
                     activated_at)
                  VALUES (?1, 'building', 0, 0, 0, ?2, NULL);`,
            bind: [mutation.generationId, mutation.startedAt],
          });
          if (activeGeneration !== null) {
            this.#database.exec({
              sql: `INSERT INTO library_device_contacts
                      (generation_id, resource_name, etag, display_name,
                       given_name, family_name, middle_name, deleted, updated_at)
                    SELECT ?1, resource_name, etag, display_name, given_name,
                           family_name, middle_name, deleted, updated_at
                    FROM library_device_contacts
                    WHERE generation_id = ?2 COLLATE BINARY;`,
              bind: [mutation.generationId, activeGeneration],
            });
            for (const table of [
              "library_device_contact_emails",
              "library_device_contact_phones",
            ]) {
              this.#database.exec({
                sql: `INSERT INTO ${table}
                        (generation_id, resource_name, ordinal, value, type_value)
                      SELECT ?1, resource_name, ordinal, value, type_value
                      FROM ${table}
                      WHERE generation_id = ?2 COLLATE BINARY;`,
                bind: [mutation.generationId, activeGeneration],
              });
            }
            this.#database.exec({
              sql: `INSERT INTO library_device_contact_photos
                      (generation_id, resource_name, ordinal, url, is_default)
                    SELECT ?1, resource_name, ordinal, url, is_default
                    FROM library_device_contact_photos
                    WHERE generation_id = ?2 COLLATE BINARY;`,
              bind: [mutation.generationId, activeGeneration],
            });
            this.#database.exec({
              sql: `INSERT INTO library_device_contact_organizations
                      (generation_id, resource_name, ordinal, name, title)
                    SELECT ?1, resource_name, ordinal, name, title
                    FROM library_device_contact_organizations
                    WHERE generation_id = ?2 COLLATE BINARY;`,
              bind: [mutation.generationId, activeGeneration],
            });
          }
          const contactCount = safeInteger(
            this.#database.exec({
              sql: `SELECT count(*) FROM library_device_contacts
                    WHERE generation_id = ?1 COLLATE BINARY;`,
              bind: [mutation.generationId],
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "building device contact count",
          );
          this.#database.exec({
            sql: `UPDATE library_device_contact_generations
                  SET expected_contact_count = ?2, staged_contact_count = ?2
                  WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';`,
            bind: [mutation.generationId, contactCount],
          });
          this.#database.exec({
            sql: `UPDATE library_device_contact_sync_state
                  SET auth_status = 'connected', sync_status = 'syncing',
                      sync_started_at = ?1, last_error_code = NULL,
                      last_error_message = NULL, revision = revision + 1,
                      updated_at = ?1
                  WHERE singleton_id = 1 AND revision < 9007199254740991;`,
            bind: [mutation.startedAt],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact revision cannot advance");
          }
          changed = true;
        }
      } else if (mutation.mutationKind === "device_contact_delta_append_v1") {
        const batchDigest =
          digestLibraryCoreDeviceContactSyncMutationV1(mutation);
        const receiptRows = this.#database.exec({
          sql: `SELECT batch_digest
                FROM library_device_contact_delta_receipts
                WHERE generation_id = ?1 COLLATE BINARY AND batch_ordinal = ?2;`,
          bind: [mutation.generationId, mutation.batchOrdinal],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (receiptRows.length === 1) {
          if (
            text(receiptRows[0]![0], "device contact batch digest") !==
            batchDigest
          ) {
            throw new Error("device contact delta replay changed");
          }
        } else {
          const expectedOrdinal = safeInteger(
            this.#database.exec({
              sql: `SELECT count(*) FROM library_device_contact_delta_receipts
                    WHERE generation_id = ?1 COLLATE BINARY;`,
              bind: [mutation.generationId],
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "device contact next batch ordinal",
          );
          if (mutation.batchOrdinal !== expectedOrdinal) {
            throw new Error(
              "device contact delta batch ordinal is not contiguous",
            );
          }
          const generationState = this.#database.exec({
            sql: `SELECT state FROM library_device_contact_generations
                  WHERE generation_id = ?1 COLLATE BINARY;`,
            bind: [mutation.generationId],
            rowMode: 0,
            returnValue: "resultRows",
          });
          if (
            generationState.length !== 1 ||
            generationState[0] !== "building"
          ) {
            throw new Error("device contact generation is not building");
          }
          for (const resourceName of mutation.deletedResourceNames) {
            this.#database.exec({
              sql: `DELETE FROM library_device_contacts
                    WHERE generation_id = ?1 COLLATE BINARY
                      AND resource_name = ?2 COLLATE BINARY;`,
              bind: [mutation.generationId, resourceName],
            });
          }
          for (const contact of mutation.contacts) {
            this.#database.exec({
              sql: `DELETE FROM library_device_contacts
                    WHERE generation_id = ?1 COLLATE BINARY
                      AND resource_name = ?2 COLLATE BINARY;`,
              bind: [mutation.generationId, contact.resourceName],
            });
            this.#database.exec({
              sql: `INSERT INTO library_device_contacts
                      (generation_id, resource_name, etag, display_name,
                       given_name, family_name, middle_name, deleted, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9);`,
              bind: [
                mutation.generationId,
                contact.resourceName,
                contact.etag ?? null,
                contact.name.displayName ?? null,
                contact.name.givenName ?? null,
                contact.name.familyName ?? null,
                contact.name.middleName ?? null,
                contact.metadata?.deleted === true ? 1 : 0,
                mutation.updatedAt,
              ],
            });
            contact.emails.forEach((entry, ordinal) => {
              this.#database.exec({
                sql: `INSERT INTO library_device_contact_emails
                        (generation_id, resource_name, ordinal, value, type_value)
                      VALUES (?1, ?2, ?3, ?4, ?5);`,
                bind: [
                  mutation.generationId,
                  contact.resourceName,
                  ordinal,
                  entry.value,
                  entry.type ?? null,
                ],
              });
            });
            contact.phones.forEach((entry, ordinal) => {
              this.#database.exec({
                sql: `INSERT INTO library_device_contact_phones
                        (generation_id, resource_name, ordinal, value, type_value)
                      VALUES (?1, ?2, ?3, ?4, ?5);`,
                bind: [
                  mutation.generationId,
                  contact.resourceName,
                  ordinal,
                  entry.value,
                  entry.type ?? null,
                ],
              });
            });
            contact.photos.forEach((entry, ordinal) => {
              this.#database.exec({
                sql: `INSERT INTO library_device_contact_photos
                        (generation_id, resource_name, ordinal, url, is_default)
                      VALUES (?1, ?2, ?3, ?4, ?5);`,
                bind: [
                  mutation.generationId,
                  contact.resourceName,
                  ordinal,
                  entry.url,
                  entry.default === true ? 1 : 0,
                ],
              });
            });
            contact.organizations.forEach((entry, ordinal) => {
              this.#database.exec({
                sql: `INSERT INTO library_device_contact_organizations
                        (generation_id, resource_name, ordinal, name, title)
                      VALUES (?1, ?2, ?3, ?4, ?5);`,
                bind: [
                  mutation.generationId,
                  contact.resourceName,
                  ordinal,
                  entry.name ?? null,
                  entry.title ?? null,
                ],
              });
            });
          }
          this.#database.exec({
            sql: `INSERT INTO library_device_contact_delta_receipts
                    (generation_id, batch_ordinal, batch_digest, applied_at)
                  VALUES (?1, ?2, ?3, ?4);`,
            bind: [
              mutation.generationId,
              mutation.batchOrdinal,
              batchDigest,
              mutation.updatedAt,
            ],
          });
          const stagedContactCount = safeInteger(
            this.#database.exec({
              sql: `SELECT count(*) FROM library_device_contacts
                    WHERE generation_id = ?1 COLLATE BINARY AND deleted = 0;`,
              bind: [mutation.generationId],
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "staged device contact count",
          );
          this.#database.exec({
            sql: `UPDATE library_device_contact_generations
                  SET expected_contact_count = ?2, staged_contact_count = ?2
                  WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';`,
            bind: [mutation.generationId, stagedContactCount],
          });
          this.#database.exec({
            sql: `UPDATE library_device_contact_sync_state
                  SET revision = revision + 1, updated_at = ?1
                  WHERE singleton_id = 1 AND revision < 9007199254740991;`,
            bind: [mutation.updatedAt],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact revision cannot advance");
          }
          changed = true;
        }
      } else if (mutation.mutationKind === "device_contact_match_append_v1") {
        for (const match of mutation.matches) {
          const resultDigest = digestLibraryCoreDeviceContactSyncMutationV1({
            ...mutation,
            matches: [match],
          });
          const receiptRows = this.#database.exec({
            sql: `SELECT result_digest
                  FROM library_device_contact_match_receipts
                  WHERE generation_id = ?1 COLLATE BINARY
                    AND resource_name = ?2 COLLATE BINARY;`,
            bind: [mutation.generationId, match.resourceName],
            rowMode: 0,
            returnValue: "resultRows",
          });
          if (receiptRows.length === 1) {
            if (receiptRows[0] !== resultDigest) {
              throw new Error("device contact match replay changed");
            }
            continue;
          }
          const contactExists = safeInteger(
            this.#database.exec({
              sql: `SELECT EXISTS(
                      SELECT 1 FROM library_device_contacts AS contact
                      JOIN library_device_contact_generations AS generation
                        ON generation.generation_id = contact.generation_id
                      WHERE contact.generation_id = ?1 COLLATE BINARY
                        AND contact.resource_name = ?2 COLLATE BINARY
                        AND contact.deleted = 0 AND generation.state = 'building'
                    );`,
              bind: [mutation.generationId, match.resourceName],
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "device contact match target existence",
          );
          if (contactExists !== 1) {
            throw new Error("device contact match target is unavailable");
          }
          if (match.suggestion !== null) {
            const activeGeneration = nullableText(
              this.#database.exec({
                sql: `SELECT active_generation_id
                      FROM library_device_contact_sync_state
                      WHERE singleton_id = 1;`,
                rowMode: 0,
                returnValue: "resultRows",
              })[0],
              "active device contact generation",
            );
            const dismissedAt =
              activeGeneration === null
                ? null
                : nullableInteger(
                    this.#database.exec({
                      sql: `SELECT dismissed_at
                          FROM library_device_contact_suggestions
                          WHERE generation_id = ?1 COLLATE BINARY
                            AND suggestion_id = ?2 COLLATE BINARY;`,
                      bind: [activeGeneration, match.suggestion.id],
                      rowMode: 0,
                      returnValue: "resultRows",
                    })[0] ?? null,
                    "device contact suggestion dismissal",
                  );
            this.#database.exec({
              sql: `INSERT INTO library_device_contact_suggestions
                      (generation_id, suggestion_id, resource_name, kind,
                       confidence, person_id, label, reason, created_at,
                       dismissed_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);`,
              bind: [
                mutation.generationId,
                match.suggestion.id,
                match.resourceName,
                match.suggestion.kind,
                match.suggestion.confidence,
                match.suggestion.personId ?? null,
                match.suggestion.label,
                match.suggestion.reason ?? null,
                match.suggestion.createdAt,
                dismissedAt,
              ],
            });
            match.suggestion.accountIds.forEach((accountId, ordinal) => {
              this.#database.exec({
                sql: `INSERT INTO library_device_contact_suggestion_accounts
                        (generation_id, suggestion_id, ordinal, account_id)
                      VALUES (?1, ?2, ?3, ?4);`,
                bind: [
                  mutation.generationId,
                  match.suggestion!.id,
                  ordinal,
                  accountId,
                ],
              });
            });
          }
          this.#database.exec({
            sql: `INSERT INTO library_device_contact_match_receipts
                    (generation_id, resource_name, result_digest, matched_at)
                  VALUES (?1, ?2, ?3, ?4);`,
            bind: [
              mutation.generationId,
              match.resourceName,
              resultDigest,
              mutation.matchedAt,
            ],
          });
          changed = true;
        }
        if (changed) {
          const matchedContactCount = safeInteger(
            this.#database.exec({
              sql: `SELECT count(*) FROM library_device_contact_match_receipts
                    WHERE generation_id = ?1 COLLATE BINARY;`,
              bind: [mutation.generationId],
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "matched device contact count",
          );
          this.#database.exec({
            sql: `UPDATE library_device_contact_generations
                  SET matched_contact_count = ?2
                  WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';`,
            bind: [mutation.generationId, matchedContactCount],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact generation is not building");
          }
          this.#database.exec({
            sql: `UPDATE library_device_contact_sync_state
                  SET revision = revision + 1, updated_at = ?1
                  WHERE singleton_id = 1 AND revision < 9007199254740991;`,
            bind: [mutation.matchedAt],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact revision cannot advance");
          }
        }
      } else if (
        mutation.mutationKind === "device_contact_generation_activate_v1"
      ) {
        const activeRows = this.#database.exec({
          sql: `SELECT active_generation_id, sync_token, last_synced_at
                FROM library_device_contact_sync_state
                WHERE singleton_id = 1;`,
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (activeRows.length !== 1) {
          throw new Error("device contact sync state is unavailable");
        }
        const priorActiveGeneration = nullableText(
          activeRows[0]![0],
          "active device contact generation",
        );
        if (priorActiveGeneration === mutation.generationId) {
          if (
            nullableText(activeRows[0]![1], "device contact sync token") !==
              mutation.nextSyncToken ||
            nullableInteger(activeRows[0]![2], "device contact sync time") !==
              mutation.activatedAt
          ) {
            throw new Error("device contact activation replay changed");
          }
        } else {
          const generationRows = this.#database.exec({
            sql: `SELECT state, staged_contact_count, matched_contact_count
                  FROM library_device_contact_generations
                  WHERE generation_id = ?1 COLLATE BINARY;`,
            bind: [mutation.generationId],
            rowMode: "array",
            returnValue: "resultRows",
          });
          if (
            generationRows.length !== 1 ||
            generationRows[0]![0] !== "building" ||
            safeInteger(
              generationRows[0]![1],
              "staged device contact count",
            ) !== mutation.expectedContactCount ||
            safeInteger(
              generationRows[0]![2],
              "matched device contact count",
            ) !== mutation.expectedContactCount
          ) {
            throw new Error("device contact generation is incomplete");
          }
          this.#database.exec({
            sql: `UPDATE library_device_contact_sync_state
                  SET active_generation_id = ?1, auth_status = 'connected',
                      sync_status = 'idle', sync_started_at = NULL,
                      sync_token = ?2, last_synced_at = ?3,
                      last_error_code = NULL, last_error_message = NULL,
                      revision = revision + 1, updated_at = ?3
                  WHERE singleton_id = 1 AND revision < 9007199254740991;`,
            bind: [
              mutation.generationId,
              mutation.nextSyncToken,
              mutation.activatedAt,
            ],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact revision cannot advance");
          }
          if (priorActiveGeneration !== null) {
            this.#database.exec({
              sql: `DELETE FROM library_device_contact_generations
                    WHERE generation_id = ?1 COLLATE BINARY;`,
              bind: [priorActiveGeneration],
            });
          }
          this.#database.exec({
            sql: `UPDATE library_device_contact_generations
                  SET state = 'active', activated_at = ?2
                  WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';`,
            bind: [mutation.generationId, mutation.activatedAt],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact generation activation failed");
          }
          changed = true;
        }
      } else if (mutation.mutationKind === "device_contact_status_set_v1") {
        const stateRows = this.#database.exec({
          sql: `SELECT auth_status, sync_status, sync_started_at,
                       last_error_code, last_error_message
                FROM library_device_contact_sync_state
                WHERE singleton_id = 1;`,
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (stateRows.length !== 1) {
          throw new Error("device contact sync state is unavailable");
        }
        const current = stateRows[0]!;
        changed =
          current[0] !== mutation.authStatus ||
          current[1] !== mutation.syncStatus ||
          current[2] !== mutation.syncStartedAt ||
          current[3] !== mutation.errorCode ||
          current[4] !== mutation.errorMessage;
        if (changed) {
          this.#database.exec({
            sql: `UPDATE library_device_contact_sync_state
                  SET auth_status = ?1, sync_status = ?2, sync_started_at = ?3,
                      last_error_code = ?4, last_error_message = ?5,
                      revision = revision + 1, updated_at = ?6
                  WHERE singleton_id = 1 AND revision < 9007199254740991;`,
            bind: [
              mutation.authStatus,
              mutation.syncStatus,
              mutation.syncStartedAt,
              mutation.errorCode,
              mutation.errorMessage,
              mutation.updatedAt,
            ],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact revision cannot advance");
          }
        }
      } else {
        const activeGeneration = nullableText(
          this.#database.exec({
            sql: `SELECT active_generation_id
                  FROM library_device_contact_sync_state
                  WHERE singleton_id = 1;`,
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "active device contact generation",
        );
        if (activeGeneration === null) {
          throw new Error("device contact generation is unavailable");
        }
        const rows = this.#database.exec({
          sql: `SELECT dismissed_at
                FROM library_device_contact_suggestions
                WHERE generation_id = ?1 COLLATE BINARY
                  AND suggestion_id = ?2 COLLATE BINARY;`,
          bind: [activeGeneration, mutation.suggestionId],
          rowMode: 0,
          returnValue: "resultRows",
        });
        if (rows.length !== 1) {
          throw new Error("device contact suggestion is unavailable");
        }
        const dismissedAt = nullableInteger(
          rows[0],
          "device contact suggestion dismissal",
        );
        if (dismissedAt === null) {
          this.#database.exec({
            sql: `UPDATE library_device_contact_suggestions
                  SET dismissed_at = ?3
                  WHERE generation_id = ?1 COLLATE BINARY
                    AND suggestion_id = ?2 COLLATE BINARY
                    AND dismissed_at IS NULL;`,
            bind: [
              activeGeneration,
              mutation.suggestionId,
              mutation.dismissedAt,
            ],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact suggestion dismissal raced");
          }
          this.#database.exec({
            sql: `UPDATE library_device_contact_sync_state
                  SET revision = revision + 1, updated_at = ?1
                  WHERE singleton_id = 1 AND revision < 9007199254740991;`,
            bind: [mutation.dismissedAt],
          });
          if (this.#database.changes() !== 1) {
            throw new Error("device contact revision cannot advance");
          }
          changed = true;
        } else if (dismissedAt !== mutation.dismissedAt) {
          throw new Error("device contact dismissal replay changed");
        }
      }
      const generationId =
        mutation.mutationKind === "device_contact_status_set_v1" ||
        mutation.mutationKind === "device_contact_suggestion_dismiss_v1"
          ? null
          : mutation.generationId;
      const receipt = deviceContactMutationReceipt(
        this.#database,
        generationId,
        changed,
      );
      this.#database.exec("COMMIT;");
      return receipt;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  mutateContentPolicy(
    input: LibraryCoreContentPolicyMutationV1,
  ): LibraryCoreContentPolicyMutationReceiptV1 {
    const parsed = parseLibraryCoreContentPolicyMutationV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const mutation = parsed.value;
    const program =
      LIBRARY_CORE_SQLITE_LOCAL_MUTATION_PROGRAMS.content_policy_set_v1;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const targetExists = safeInteger(
        this.#database.exec({
          sql: program.targetExistsSql,
          bind: [mutation.contentDigest],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "selective content descriptor existence",
      );
      if (targetExists !== 1) {
        throw new Error("selective content descriptor is unavailable");
      }
      const current = this.#database.exec({
        sql: `SELECT policy, updated_at FROM library_device_content_policies
              WHERE content_digest = ?1 COLLATE BINARY;`,
        bind: [mutation.contentDigest],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (current.length > 1) {
        throw new Error("selective content policy is ambiguous");
      }
      if (current.length === 1) {
        const currentPolicy = text(current[0]![0], "selective content policy");
        const currentUpdatedAt = safeInteger(
          current[0]![1],
          "selective content policy clock",
        );
        if (
          currentUpdatedAt > mutation.updatedAt ||
          (currentUpdatedAt === mutation.updatedAt &&
            currentPolicy !== mutation.policy)
        ) {
          throw new Error(
            "selective content policy clock is stale or ambiguous",
          );
        }
      }
      this.#database.exec({
        sql: program.sql,
        bind: [mutation.contentDigest, mutation.policy, mutation.updatedAt],
      });
      const changed = safeInteger(
        this.#database.exec({
          sql: "SELECT changes();",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "selective content policy row count",
      );
      if (changed > program.maximumRows) {
        throw new Error("selective content policy exceeded its row bound");
      }
      if (changed === 1) {
        this.#database.exec({
          sql: `UPDATE library_device_content_availability
                SET hydration_state = CASE ?2
                      WHEN 'pinned_offline' THEN 'pinned_offline'
                      ELSE 'fully_cached'
                    END,
                    updated_at = ?3
                WHERE content_digest = ?1 COLLATE BINARY
                  AND complete_digest_verified_at IS NOT NULL;`,
          bind: [mutation.contentDigest, mutation.policy, mutation.updatedAt],
        });
        this.#database.exec(`UPDATE library_device_content_state
          SET revision = revision + 1
          WHERE singleton_id = 1 AND revision < 9007199254740991;`);
        const advanced = safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "selective content revision row count",
        );
        if (advanced !== 1) {
          throw new Error("selective content revision cannot advance");
        }
      }
      const contentRevision = safeInteger(
        this.#database.exec({
          sql: "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "selective content revision",
      );
      this.#database.exec("COMMIT;");
      const receipt = parseLibraryCoreContentPolicyMutationReceiptV1({
        changed: changed === 1,
        contentDigest: mutation.contentDigest,
        contentRevision,
        policy: mutation.policy,
        schemaVersion: 1,
        updatedAt: mutation.updatedAt,
      });
      if (!receipt.ok) throw new TypeError(receipt.error);
      return receipt.value;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  readContentState(
    input: LibraryCoreContentStateRequestV1,
  ): LibraryCoreContentStateV1 {
    const parsed = parseLibraryCoreContentStateRequestV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    const rows = this.#database.exec({
      sql: `SELECT blob.byte_length, blob.media_type,
                   COALESCE(policy.policy, 'metadata_only'), policy.updated_at,
                   availability.hydration_state, availability.verified_bytes,
                   availability.storage_kind, availability.complete_digest_verified_at,
                   availability.last_accessed_at, availability.updated_at,
                   state.revision
            FROM library_blobs AS blob
            CROSS JOIN library_device_content_state AS state
            LEFT JOIN library_device_content_policies AS policy
              ON policy.content_digest = blob.content_digest
            LEFT JOIN library_device_content_availability AS availability
              ON availability.content_digest = blob.content_digest
            WHERE blob.content_digest = ?1 COLLATE BINARY AND state.singleton_id = 1
            LIMIT 1;`,
      bind: [request.contentDigest],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("selective content descriptor is unavailable");
    }
    const row = rows[0]!;
    const state = parseLibraryCoreContentStateV1({
      availability:
        row[4] === null
          ? null
          : {
              completeDigestVerifiedAt:
                row[7] === null
                  ? null
                  : safeInteger(
                      row[7],
                      "complete content digest verification time",
                    ),
              hydrationState: text(row[4], "content hydration state"),
              lastAccessedAt: safeInteger(row[8], "content last access time"),
              storageKind: text(row[6], "content storage kind"),
              updatedAt: safeInteger(
                row[9],
                "content availability update time",
              ),
              verifiedBytes: safeInteger(row[5], "verified content bytes"),
            },
      byteLength: safeInteger(row[0], "content byte length"),
      contentDigest: request.contentDigest,
      contentRevision: safeInteger(row[10], "selective content revision"),
      mediaType: text(row[1], "content media type"),
      policy: text(row[2], "selective content policy"),
      policyUpdatedAt:
        row[3] === null
          ? null
          : safeInteger(row[3], "content policy update time"),
      schemaVersion: 1,
    });
    if (!state.ok) throw new TypeError(state.error);
    return state.value;
  }

  pageHydrationCandidates(
    input: LibraryCoreHydrationCandidatePageRequestV1,
  ): LibraryCoreHydrationCandidatePageV1 {
    const parsed = parseLibraryCoreHydrationCandidatePageRequestV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    const source = this.#contentWorkSource(request.source);
    const after = request.after;
    const rows = this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_CONTENT_WORK_PROGRAMS.hydration_candidates_page_v1,
      bind: [
        after?.policyPriority ?? null,
        after?.policyUpdatedAt ?? null,
        after?.contentDigest ?? null,
        after?.rangeIndex ?? null,
        request.limit + 1,
      ],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const hasMore = rows.length > request.limit;
    const pageRows = rows.slice(0, request.limit).map((row) => ({
      byteLength: safeInteger(row[5], "hydration candidate byte length"),
      byteOffset: safeInteger(row[4], "hydration candidate byte offset"),
      cloudAvailabilityCommitment: text(row[9], "hydration cloud commitment"),
      contentDigest: text(row[2], "hydration content digest"),
      mediaType: text(row[7], "hydration media type"),
      policy: text(row[8], "hydration policy"),
      policyPriority: safeInteger(row[0], "hydration policy priority"),
      policyUpdatedAt: safeInteger(row[1], "hydration policy time"),
      rangeContentDigest: text(row[6], "hydration range digest"),
      rangeIndex: safeInteger(row[3], "hydration range index"),
    }));
    const last = pageRows.at(-1);
    const response = parseLibraryCoreHydrationCandidatePageV1({
      next:
        hasMore && last
          ? {
              contentDigest: last.contentDigest,
              policyPriority: last.policyPriority,
              policyUpdatedAt: last.policyUpdatedAt,
              rangeIndex: last.rangeIndex,
            }
          : null,
      rows: pageRows,
      schemaVersion: 1,
      source,
    });
    if (!response.ok) throw new TypeError(response.error);
    return response.value;
  }

  pageEvictionCandidates(
    input: LibraryCoreEvictionCandidatePageRequestV1,
  ): LibraryCoreEvictionCandidatePageV1 {
    const parsed = parseLibraryCoreEvictionCandidatePageRequestV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    const source = this.#contentWorkSource(request.source);
    const after = request.after;
    const rows = this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_CONTENT_WORK_PROGRAMS.eviction_candidates_page_v1,
      bind: [
        request.notAccessedAfter,
        after?.policyPriority ?? null,
        after?.lastAccessedAt ?? null,
        after?.contentDigest ?? null,
        request.limit + 1,
      ],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const hasMore = rows.length > request.limit;
    const pageRows = rows.slice(0, request.limit).map((row) => ({
      contentDigest: text(row[2], "eviction content digest"),
      hydrationState: text(row[4], "eviction hydration state"),
      lastAccessedAt: safeInteger(row[1], "eviction access time"),
      policy: text(row[3], "eviction policy"),
      policyPriority: safeInteger(row[0], "eviction policy priority"),
      verifiedBytes: safeInteger(row[5], "eviction verified bytes"),
    }));
    const last = pageRows.at(-1);
    const response = parseLibraryCoreEvictionCandidatePageV1({
      next:
        hasMore && last
          ? {
              contentDigest: last.contentDigest,
              lastAccessedAt: last.lastAccessedAt,
              policyPriority: last.policyPriority,
            }
          : null,
      rows: pageRows,
      schemaVersion: 1,
      source,
    });
    if (!response.ok) throw new TypeError(response.error);
    return response.value;
  }

  #contentWorkSource(
    expected: LibraryCoreContentWorkSourceV1 | null,
  ): LibraryCoreContentWorkSourceV1 {
    const canonical = this.#querySource();
    const contentRevision = safeInteger(
      this.#database.exec({
        sql: "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "content work revision",
    );
    const source = Object.freeze({
      contentRevision,
      generationId: canonical.generationId,
      sourceRevision: canonical.sourceRevision,
      transitionSequence: canonical.sourceRevision,
    });
    if (
      expected !== null &&
      (expected.contentRevision !== source.contentRevision ||
        expected.generationId !== source.generationId ||
        expected.sourceRevision !== source.sourceRevision ||
        expected.transitionSequence !== source.transitionSequence)
    ) {
      throw new Error("content work source is stale");
    }
    return source;
  }

  readCanonicalContentRange(
    contentDigest: string,
    rangeIndex: number,
  ): Readonly<{
    byteLength: number;
    rangeContentDigest: string;
  }> {
    if (
      !isLibraryCoreLowercaseHex64(contentDigest) ||
      !Number.isSafeInteger(rangeIndex) ||
      rangeIndex < 0
    ) {
      throw new TypeError("canonical content range request is invalid");
    }
    const rows = this.#database.exec({
      sql: `SELECT range.byte_length, range.range_digest
            FROM library_content_ranges AS range
            JOIN library_blobs AS blob ON blob.content_digest = range.content_digest
            WHERE range.content_digest = ?1 COLLATE BINARY
              AND range.range_index = ?2
              AND blob.storage_layout = 'authenticated_ranges'
            LIMIT 1;`,
      bind: [contentDigest, rangeIndex],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("canonical content range is unavailable");
    }
    return Object.freeze({
      byteLength: safeInteger(rows[0]![0], "canonical content range length"),
      rangeContentDigest: text(rows[0]![1], "canonical content range digest"),
    });
  }

  markContentAccessed(contentDigest: string, accessedAt: number): void {
    if (
      !isLibraryCoreLowercaseHex64(contentDigest) ||
      !Number.isSafeInteger(accessedAt) ||
      accessedAt < 0
    ) {
      throw new TypeError("content access record is invalid");
    }
    this.#database.exec({
      sql: `UPDATE library_device_content_availability
            SET last_accessed_at = ?2
            WHERE content_digest = ?1 COLLATE BINARY
              AND last_accessed_at < ?2
              AND (last_accessed_at = 0 OR ?2 - last_accessed_at >= 60000);`,
      bind: [contentDigest, accessedAt],
    });
  }

  readVerifiedContentRangeReadProof(
    contentDigest: string,
    rangeIndex: number,
  ): Readonly<{ byteLength: number; storageKey: string }> {
    if (
      !isLibraryCoreLowercaseHex64(contentDigest) ||
      !Number.isSafeInteger(rangeIndex) ||
      rangeIndex < 0
    ) {
      throw new TypeError("verified content range read identity is invalid");
    }
    const rows = this.#database.exec({
      sql: `SELECT local.verified_byte_length, local.storage_key
            FROM library_device_content_ranges AS local
            JOIN library_content_ranges AS canonical
              ON canonical.content_digest = local.content_digest
             AND canonical.range_index = local.range_index
             AND canonical.byte_length = local.verified_byte_length
             AND canonical.range_digest = local.verified_range_digest
            WHERE local.content_digest = ?1 COLLATE BINARY
              AND local.range_index = ?2
              AND local.storage_kind = 'opfs'
            LIMIT 1;`,
      bind: [contentDigest, rangeIndex],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("verified content range is unavailable");
    }
    return Object.freeze({
      byteLength: safeInteger(rows[0]![0], "verified content range length"),
      storageKey: text(rows[0]![1], "verified content range storage key"),
    });
  }

  readContentCompletionPlan(contentDigest: string): Readonly<{
    byteLength: number;
    rangeCount: number;
  }> {
    if (!isLibraryCoreLowercaseHex64(contentDigest)) {
      throw new TypeError("content completion identity is invalid");
    }
    const rows = this.#database.exec({
      sql: `SELECT byte_length, range_count FROM library_blobs
            WHERE content_digest = ?1 COLLATE BINARY
              AND storage_layout = 'authenticated_ranges';`,
      bind: [contentDigest],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("content completion descriptor is unavailable");
    }
    return Object.freeze({
      byteLength: safeInteger(rows[0]![0], "content completion byte length"),
      rangeCount: safeInteger(rows[0]![1], "content completion range count"),
    });
  }

  pageVerifiedContentRangesForCompletion(
    contentDigest: string,
    afterRangeIndex: number | null,
  ): readonly Readonly<{
    byteLength: number;
    rangeIndex: number;
    storageKey: string;
  }>[] {
    if (
      !isLibraryCoreLowercaseHex64(contentDigest) ||
      (afterRangeIndex !== null &&
        (!Number.isSafeInteger(afterRangeIndex) || afterRangeIndex < 0))
    ) {
      throw new TypeError("content completion page request is invalid");
    }
    const rows = this.#database.exec({
      sql: `SELECT local.range_index, local.verified_byte_length, local.storage_key
            FROM library_device_content_ranges AS local
            JOIN library_content_ranges AS canonical
              ON canonical.content_digest = local.content_digest
             AND canonical.range_index = local.range_index
             AND canonical.byte_length = local.verified_byte_length
             AND canonical.range_digest = local.verified_range_digest
            WHERE local.content_digest = ?1 COLLATE BINARY
              AND local.storage_kind = 'opfs'
              AND (?2 IS NULL OR local.range_index > ?2)
            ORDER BY local.range_index ASC LIMIT 128;`,
      bind: [contentDigest, afterRangeIndex],
      rowMode: "array",
      returnValue: "resultRows",
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          byteLength: safeInteger(row[1], "content completion range length"),
          rangeIndex: safeInteger(row[0], "content completion range index"),
          storageKey: text(row[2], "content completion storage key"),
        }),
      ),
    );
  }

  registerVerifiedContentCompletion(
    input: LibraryCoreContentCompletionRequestV1,
  ): LibraryCoreContentCompletionReceiptV1 {
    const parsed = parseLibraryCoreContentCompletionRequestV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const request = parsed.value;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.#database.exec({
        sql: `SELECT blob.byte_length, blob.range_count,
                     count(local.range_index),
                     (SELECT count(*) FROM library_device_content_ranges AS all_local
                      WHERE all_local.content_digest = blob.content_digest
                        AND all_local.storage_kind = 'opfs'),
                     (SELECT COALESCE(sum(all_local.verified_byte_length), 0)
                      FROM library_device_content_ranges AS all_local
                      WHERE all_local.content_digest = blob.content_digest
                        AND all_local.storage_kind = 'opfs'),
                     COALESCE(policy.policy, 'metadata_only')
              FROM library_blobs AS blob
              LEFT JOIN library_content_ranges AS canonical
                ON canonical.content_digest = blob.content_digest
              LEFT JOIN library_device_content_ranges AS local
                ON local.content_digest = canonical.content_digest
               AND local.range_index = canonical.range_index
               AND local.verified_byte_length = canonical.byte_length
               AND local.verified_range_digest = canonical.range_digest
               AND local.storage_kind = 'opfs'
              LEFT JOIN library_device_content_policies AS policy
                ON policy.content_digest = blob.content_digest
              WHERE blob.content_digest = ?1 COLLATE BINARY
                AND blob.storage_layout = 'authenticated_ranges'
              GROUP BY blob.content_digest;`,
        bind: [request.contentDigest],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (rows.length !== 1) {
        throw new Error("content completion descriptor is unavailable");
      }
      const byteLength = safeInteger(rows[0]![0], "content completion length");
      const rangeCount = safeInteger(
        rows[0]![1],
        "content completion range count",
      );
      const verifiedRangeCount = safeInteger(
        rows[0]![2],
        "verified range count",
      );
      const localRangeCount = safeInteger(rows[0]![3], "local range count");
      const verifiedBytes = safeInteger(rows[0]![4], "verified content bytes");
      if (
        verifiedRangeCount !== rangeCount ||
        localRangeCount !== rangeCount ||
        verifiedBytes !== byteLength
      ) {
        throw new Error("content completion requires every canonical range");
      }
      const hydrationState =
        rows[0]![5] === "pinned_offline" ? "pinned_offline" : "fully_cached";
      const current = this.#database.exec({
        sql: `SELECT hydration_state, verified_bytes, storage_kind,
                     complete_digest_verified_at
              FROM library_device_content_availability
              WHERE content_digest = ?1 COLLATE BINARY;`,
        bind: [request.contentDigest],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const changed =
        current.length !== 1 ||
        current[0]![0] !== hydrationState ||
        current[0]![1] !== verifiedBytes ||
        current[0]![2] !== "opfs" ||
        current[0]![3] !== request.verifiedAt;
      if (changed) {
        this.#database.exec({
          sql: `INSERT INTO library_device_content_availability
                  (content_digest, hydration_state, verified_bytes, storage_kind,
                   complete_digest_verified_at, last_accessed_at, updated_at)
                VALUES (?1, ?2, ?3, 'opfs', ?4, ?4, ?4)
                ON CONFLICT(content_digest) DO UPDATE SET
                  hydration_state = excluded.hydration_state,
                  verified_bytes = excluded.verified_bytes,
                  storage_kind = excluded.storage_kind,
                  complete_digest_verified_at = excluded.complete_digest_verified_at,
                  updated_at = excluded.updated_at;`,
          bind: [
            request.contentDigest,
            hydrationState,
            verifiedBytes,
            request.verifiedAt,
          ],
        });
        this.#database.exec(`UPDATE library_device_content_state
          SET revision = revision + 1
          WHERE singleton_id = 1 AND revision < 9007199254740991;`);
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "content completion revision row count",
          ) !== 1
        ) {
          throw new Error("selective content revision cannot advance");
        }
      }
      const contentRevision = safeInteger(
        this.#database.exec({
          sql: "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "selective content revision",
      );
      const receipt = parseLibraryCoreContentCompletionReceiptV1({
        changed,
        contentDigest: request.contentDigest,
        contentRevision,
        hydrationState,
        schemaVersion: 1,
        verifiedBytes,
      });
      if (!receipt.ok) throw new TypeError(receipt.error);
      this.#database.exec("COMMIT;");
      return receipt.value;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  markContentCorrupt(contentDigest: string, detectedAt: number): void {
    if (
      !isLibraryCoreLowercaseHex64(contentDigest) ||
      !Number.isSafeInteger(detectedAt) ||
      detectedAt < 0
    ) {
      throw new TypeError("content corruption report is invalid");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database.exec({
        sql: `UPDATE library_device_content_availability
              SET hydration_state = 'corrupt',
                  complete_digest_verified_at = NULL,
                  updated_at = ?2
              WHERE content_digest = ?1 COLLATE BINARY
                AND (hydration_state IS NOT 'corrupt'
                     OR complete_digest_verified_at IS NOT NULL
                     OR updated_at IS NOT ?2);`,
        bind: [contentDigest, detectedAt],
      });
      const changed = safeInteger(
        this.#database.exec({
          sql: "SELECT changes();",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "content corruption row count",
      );
      if (changed === 1) {
        this.#database.exec(`UPDATE library_device_content_state
          SET revision = revision + 1
          WHERE singleton_id = 1 AND revision < 9007199254740991;`);
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "content corruption revision row count",
          ) !== 1
        ) {
          throw new Error("selective content revision cannot advance");
        }
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  registerVerifiedContentRange(
    input: LibraryCoreVerifiedContentRangePublicationV1,
  ): LibraryCoreVerifiedContentRangeReceiptV1 {
    const parsed = parseLibraryCoreVerifiedContentRangePublicationV1(input);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const publication = parsed.value;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const canonicalRows = this.#database.exec({
        sql: `SELECT range.byte_length, range.range_digest, blob.byte_length
              FROM library_content_ranges AS range
              JOIN library_blobs AS blob ON blob.content_digest = range.content_digest
              WHERE range.content_digest = ?1 COLLATE BINARY
                AND range.range_index = ?2
                AND blob.storage_layout = 'authenticated_ranges'
              LIMIT 1;`,
        bind: [publication.contentDigest, publication.rangeIndex],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (canonicalRows.length !== 1) {
        throw new Error("canonical content range is unavailable");
      }
      const canonicalRangeBytes = safeInteger(
        canonicalRows[0]![0],
        "canonical content range length",
      );
      const canonicalRangeDigest = text(
        canonicalRows[0]![1],
        "canonical content range digest",
      );
      const canonicalContentBytes = safeInteger(
        canonicalRows[0]![2],
        "canonical content length",
      );
      if (
        canonicalRangeBytes !== publication.byteLength ||
        canonicalRangeDigest !== publication.rangeContentDigest
      ) {
        throw new Error(
          "verified content range does not match canonical metadata",
        );
      }
      const current = this.#database.exec({
        sql: `SELECT storage_kind, storage_key, verified_at
              FROM library_device_content_ranges
              WHERE content_digest = ?1 COLLATE BINARY AND range_index = ?2;`,
        bind: [publication.contentDigest, publication.rangeIndex],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const changed =
        current.length === 0 ||
        current[0]![0] !== publication.storageKind ||
        current[0]![1] !== publication.storageKey ||
        current[0]![2] !== publication.verifiedAt;
      if (changed) {
        this.#database.exec({
          sql: `INSERT INTO library_device_content_ranges
                  (content_digest, range_index, verified_byte_length,
                   verified_range_digest, storage_kind, storage_key, verified_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(content_digest, range_index) DO UPDATE SET
                  verified_byte_length = excluded.verified_byte_length,
                  verified_range_digest = excluded.verified_range_digest,
                  storage_kind = excluded.storage_kind,
                  storage_key = excluded.storage_key,
                  verified_at = excluded.verified_at;`,
          bind: [
            publication.contentDigest,
            publication.rangeIndex,
            canonicalRangeBytes,
            canonicalRangeDigest,
            publication.storageKind,
            publication.storageKey,
            publication.verifiedAt,
          ],
        });
      }
      const verifiedBytes = safeInteger(
        this.#database.exec({
          sql: `SELECT COALESCE(sum(verified_byte_length), 0)
                FROM library_device_content_ranges
                WHERE content_digest = ?1 COLLATE BINARY;`,
          bind: [publication.contentDigest],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "verified content byte count",
      );
      if (verifiedBytes > canonicalContentBytes) {
        throw new Error("verified content byte count exceeds its descriptor");
      }
      if (changed) {
        this.#database.exec({
          sql: `INSERT INTO library_device_content_availability
                  (content_digest, hydration_state, verified_bytes, storage_kind,
                   complete_digest_verified_at, last_accessed_at, updated_at)
                VALUES (?1, 'partially_cached', ?2, ?3, NULL, ?4, ?4)
                ON CONFLICT(content_digest) DO UPDATE SET
                  hydration_state = 'partially_cached',
                  verified_bytes = excluded.verified_bytes,
                  storage_kind = excluded.storage_kind,
                  complete_digest_verified_at = NULL,
                  updated_at = excluded.updated_at;`,
          bind: [
            publication.contentDigest,
            verifiedBytes,
            publication.storageKind,
            publication.verifiedAt,
          ],
        });
        this.#database.exec(`UPDATE library_device_content_state
          SET revision = revision + 1
          WHERE singleton_id = 1 AND revision < 9007199254740991;`);
        const advanced = safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "selective content revision row count",
        );
        if (advanced !== 1) {
          throw new Error("selective content revision cannot advance");
        }
      }
      const contentRevision = safeInteger(
        this.#database.exec({
          sql: "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "selective content revision",
      );
      const receipt = parseLibraryCoreVerifiedContentRangeReceiptV1({
        changed,
        contentDigest: publication.contentDigest,
        contentRevision,
        hydrationState: "partially_cached",
        rangeIndex: publication.rangeIndex,
        schemaVersion: 1,
        verifiedBytes,
      });
      if (!receipt.ok) throw new TypeError(receipt.error);
      this.#database.exec("COMMIT;");
      return receipt.value;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  readVerifiedContentRangeStorageProof(storageKey: string): Readonly<{
    byteLength: number;
    canonicalStorageKey: string;
    storageKey: string;
  }> | null {
    if (
      storageKey.length === 0 ||
      new TextEncoder().encode(storageKey).length > 1_024
    ) {
      throw new TypeError("content range storage key is invalid");
    }
    const rows = this.#database.exec({
      sql: `SELECT content_digest, range_index, verified_range_digest,
                   verified_byte_length, storage_key
            FROM library_device_content_ranges
            WHERE storage_kind = 'opfs' AND storage_key = ?1;`,
      bind: [storageKey],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw new Error("content range storage proof is ambiguous");
    }
    return Object.freeze({
      canonicalStorageKey: createLibraryCoreContentRangeStorageKeyV1(
        text(rows[0]![0], "verified content range identity"),
        safeInteger(rows[0]![1], "verified content range index"),
        text(rows[0]![2], "verified content range digest"),
      ),
      byteLength: safeInteger(
        rows[0]![3],
        "verified content range storage length",
      ),
      storageKey: text(rows[0]![4], "verified content range storage key"),
    });
  }

  pageVerifiedContentRangeStorageProofs(
    afterStorageKey: string | null,
  ): readonly Readonly<{
    byteLength: number;
    canonicalStorageKey: string;
    storageKey: string;
  }>[] {
    if (
      afterStorageKey !== null &&
      (afterStorageKey.length === 0 ||
        new TextEncoder().encode(afterStorageKey).length > 1_024)
    ) {
      throw new TypeError("content range storage cursor is invalid");
    }
    const rows = this.#database.exec({
      sql: `SELECT content_digest, range_index, verified_range_digest,
                   verified_byte_length, storage_key
            FROM library_device_content_ranges
            WHERE storage_kind = 'opfs'
              AND (?1 IS NULL OR storage_key > ?1 COLLATE BINARY)
            ORDER BY storage_key COLLATE BINARY ASC LIMIT 128;`,
      bind: [afterStorageKey],
      rowMode: "array",
      returnValue: "resultRows",
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          canonicalStorageKey: createLibraryCoreContentRangeStorageKeyV1(
            text(row[0], "verified content range identity"),
            safeInteger(row[1], "verified content range index"),
            text(row[2], "verified content range digest"),
          ),
          byteLength: safeInteger(
            row[3],
            "verified content range storage length",
          ),
          storageKey: text(row[4], "verified content range storage key"),
        }),
      ),
    );
  }

  pageVerifiedContentRangeStorageProofsForContent(
    contentDigest: string,
    afterRangeIndex: number | null,
  ): readonly Readonly<{
    byteLength: number;
    rangeIndex: number;
    storageKey: string;
  }>[] {
    if (
      !isLibraryCoreLowercaseHex64(contentDigest) ||
      (afterRangeIndex !== null &&
        (!Number.isSafeInteger(afterRangeIndex) || afterRangeIndex < 0))
    ) {
      throw new TypeError("content eviction cursor is invalid");
    }
    const rows = this.#database.exec({
      sql: `SELECT range_index, verified_byte_length, storage_key
            FROM library_device_content_ranges
            WHERE content_digest = ?1 COLLATE BINARY
              AND storage_kind = 'opfs'
              AND (?2 IS NULL OR range_index > ?2)
            ORDER BY range_index ASC LIMIT 128;`,
      bind: [contentDigest, afterRangeIndex],
      rowMode: "array",
      returnValue: "resultRows",
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          rangeIndex: safeInteger(row[0], "content eviction range index"),
          byteLength: safeInteger(row[1], "content eviction byte length"),
          storageKey: text(row[2], "content eviction storage key"),
        }),
      ),
    );
  }

  pruneVerifiedContentRangeStorageProofs(storageKeys: readonly string[]): void {
    if (
      storageKeys.length > 128 ||
      new Set(storageKeys).size !== storageKeys.length ||
      storageKeys.some(
        (storageKey) =>
          storageKey.length === 0 ||
          new TextEncoder().encode(storageKey).length > 1_024,
      )
    ) {
      throw new TypeError("content range storage prune request is invalid");
    }
    if (storageKeys.length === 0) return;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      let changed = false;
      for (const storageKey of storageKeys) {
        this.#database.exec({
          sql: `DELETE FROM library_device_content_ranges
                WHERE storage_kind = 'opfs' AND storage_key = ?1;`,
          bind: [storageKey],
        });
        changed ||=
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "content range storage prune row count",
          ) === 1;
      }
      this.#reconcileLocalContentState(changed);
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  followerActorEnrollmentContext(): LibraryCoreFollowerActorEnrollmentContextV2 {
    const rows = this.#database.exec({
      sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                   e.authority_key_id, e.authority_public_key
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            WHERE m.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA follower enrollment authority is unavailable");
    }
    const row = rows[0]!;
    const libraryId = text(row[0], "PWA follower enrollment Library");
    const epochId = text(row[2], "PWA follower enrollment epoch");
    const authorityKeyId = text(row[3], "PWA follower authority key ID");
    const authorityPublicKey = text(row[4], "PWA follower authority key");
    if (
      !isLibraryCoreLowercaseHex64(libraryId) ||
      !isLibraryCoreLowercaseHex64(epochId) ||
      !isLibraryCoreLowercaseHex64(authorityKeyId) ||
      !isLibraryCoreEd25519PublicKeyHex(authorityPublicKey)
    ) {
      throw new Error("PWA follower enrollment authority identity is invalid");
    }
    const frontier = this.#database.exec({
      sql: `SELECT actor_id, accepted_counter, accepted_operation_id,
                   accepted_chain_digest
            FROM library_authority_frontier
            WHERE epoch_id = ?1 ORDER BY ordinal;`,
      bind: [epochId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const requestRows = this.#database.exec({
      sql: `SELECT actor_id, actor_public_key, enrollment_request_digest,
                   canonical_enrollment_request, created_at,
                   enrollment_certificate_digest
            FROM library_follower_actor_request
            WHERE singleton_id = 1 AND library_id = ?1
              AND authority_epoch_id = ?2;`,
      bind: [libraryId, epochId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (requestRows.length > 1) {
      throw new Error("PWA follower actor request is ambiguous");
    }
    let request: LibraryCoreFollowerActorRequestReceiptV2 | null = null;
    if (requestRows.length === 1) {
      const stored = requestRows[0]!;
      const actorId = text(stored[0], "PWA follower actor identity");
      const actorPublicKey = text(stored[1], "PWA follower actor key");
      const enrollmentRequestDigest = text(
        stored[2],
        "PWA follower request digest",
      );
      if (
        !isLibraryCoreLowercaseHex64(actorId) ||
        !isLibraryCoreEd25519PublicKeyHex(actorPublicKey) ||
        !isLibraryCoreLowercaseHex64(enrollmentRequestDigest)
      ) {
        throw new Error("PWA follower actor request identity is invalid");
      }
      request = Object.freeze({
        actorId,
        actorPublicKey,
        canonicalRequestBytes: new TextEncoder().encode(
          text(stored[3], "PWA follower request bytes"),
        ),
        createdAt: safeInteger(stored[4], "PWA follower request time"),
        enrollmentRequestDigest,
        state: stored[5] === null ? "pending" : "enrolled",
      });
    }
    return Object.freeze({
      authority: Object.freeze({
        authority_key_id: authorityKeyId,
        authority_public_key: authorityPublicKey,
        epoch: safeInteger(row[1], "PWA follower authority epoch"),
        epoch_id: epochId,
        library_id: libraryId,
        observed_frontier: snapshotLibraryCoreCausalFrontier(
          frontier.map((tip) => ({
            actor_id: text(tip[0], "PWA follower frontier actor"),
            chain_digest: text(tip[3], "PWA follower frontier digest"),
            operation_id: text(tip[2], "PWA follower frontier operation"),
            sequence: safeInteger(tip[1], "PWA follower frontier sequence"),
          })),
          "PWA follower enrollment frontier",
        ),
      }),
      request,
      schemaVersion: 2,
    });
  }

  async storeFollowerActorRequest(
    input: LibraryCoreStoreFollowerActorRequestV2,
  ): Promise<LibraryCoreFollowerActorRequestReceiptV2> {
    const request = parseLibraryCoreStoreFollowerActorRequestV2(input);
    const context = this.followerActorEnrollmentContext();
    if (context.request) {
      if (
        context.request.createdAt !== request.createdAt ||
        context.request.canonicalRequestBytes.byteLength !==
          request.canonicalRequestBytes.byteLength ||
        !context.request.canonicalRequestBytes.every(
          (byte, index) => byte === request.canonicalRequestBytes[index],
        )
      ) {
        throw new Error("PWA follower actor request replay changed");
      }
      return context.request;
    }
    const decoded = decodeLibraryCoreCanonicalValue(
      request.canonicalRequestBytes,
      { maximumBytes: 65_536 },
    );
    const canonical = encodeLibraryCoreCanonicalValue(decoded, {
      maximumBytes: 65_536,
    });
    if (
      canonical.byteLength !== request.canonicalRequestBytes.byteLength ||
      !canonical.every(
        (byte, index) => byte === request.canonicalRequestBytes[index],
      )
    ) {
      throw new Error("PWA follower actor request is not canonical");
    }
    const outer = canonicalRecord(
      decoded,
      ["certificate_body", "certificate_digest"],
      "PWA follower actor request",
    );
    const body = canonicalRecord(
      outer.certificate_body,
      [
        "actor_enrollment_body",
        "enrollment_body_digest",
        "actor_proof",
        "actor_capability_body",
        "actor_capability_body_digest",
      ],
      "PWA follower actor request body",
    );
    const enrollmentInput = canonicalRecord(
      body.actor_enrollment_body,
      [
        "operation_id",
        "operation_type",
        "library_id",
        "epoch",
        "epoch_id",
        "schema_version",
        "authority_key_id",
        "installation_incarnation",
        "actor_incarnation_nonce",
        "actor_id",
        "actor_public_key",
        "actor_public_key_fingerprint",
        "observed_frontier",
        "created_at_ms",
        "signature_algorithm",
      ],
      "PWA follower actor enrollment body",
    );
    const derivedEnrollment = constructLibraryCoreActorEnrollmentBodyV1(
      {
        actor_incarnation_nonce: enrollmentInput.actor_incarnation_nonce,
        actor_public_key: enrollmentInput.actor_public_key,
        authority_key_id: enrollmentInput.authority_key_id,
        created_at_ms: enrollmentInput.created_at_ms,
        epoch: enrollmentInput.epoch,
        epoch_id: enrollmentInput.epoch_id,
        installation_incarnation: enrollmentInput.installation_incarnation,
        library_id: enrollmentInput.library_id,
        observed_frontier: enrollmentInput.observed_frontier,
        operation_id: enrollmentInput.operation_id,
      },
      { digest: coreDigest },
    );
    const capability = canonicalRecord(
      body.actor_capability_body,
      [
        "format",
        "library_id",
        "epoch",
        "epoch_id",
        "authority_key_id",
        "actor_id",
        "actor_public_key",
        "actor_class",
        "allowed_operation_types",
        "allowed_query_ids",
        "scope",
        "issuance_identity",
        "retirement_identity",
        "issued_at_ms",
        "signature_algorithm",
      ],
      "PWA follower actor capability",
    );
    const requestDigest = coreDigest("actor-capability-certificate", body);
    const actorProof = body.actor_proof;
    if (
      outer.certificate_digest !== requestDigest ||
      body.enrollment_body_digest !==
        derivedEnrollment.enrollment_body_digest ||
      derivedEnrollment.body.library_id !== context.authority.library_id ||
      derivedEnrollment.body.epoch !== context.authority.epoch ||
      derivedEnrollment.body.epoch_id !== context.authority.epoch_id ||
      derivedEnrollment.body.authority_key_id !==
        context.authority.authority_key_id ||
      derivedEnrollment.body.created_at_ms !== request.createdAt ||
      capability.actor_id !== derivedEnrollment.body.actor_id ||
      capability.actor_public_key !== derivedEnrollment.body.actor_public_key ||
      capability.library_id !== context.authority.library_id ||
      capability.epoch_id !== context.authority.epoch_id ||
      capability.actor_class !== "editor" ||
      JSON.stringify(capability.scope) !== '{"mode":"library_wide"}' ||
      JSON.stringify(capability.allowed_operation_types) !==
        JSON.stringify(LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2) ||
      JSON.stringify(capability.allowed_query_ids) !== "[]" ||
      !isLibraryCoreLowercaseHex64(requestDigest) ||
      typeof actorProof !== "string" ||
      !(await verifyLibraryCoreEd25519WithWebCrypto(
        {
          message: encodeLibraryCoreSignatureInput("actor-enrollment-proof", {
            enrollment_body_digest: derivedEnrollment.enrollment_body_digest,
          }),
          publicKeyHex: derivedEnrollment.body.actor_public_key,
          signatureHex: actorProof as never,
        },
        this.#subtle,
      ))
    ) {
      throw new Error("PWA follower actor request proof is invalid");
    }
    this.#database.exec({
      sql: `INSERT INTO library_follower_actor_request
              (singleton_id, library_id, authority_epoch_id, actor_id,
               actor_public_key, enrollment_request_digest,
               canonical_enrollment_request, created_at,
               enrollment_certificate_digest, canonical_enrollment_certificate,
               actor_chain_genesis, enrolled_at)
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    NULL, NULL, NULL, NULL);`,
      bind: [
        context.authority.library_id,
        context.authority.epoch_id,
        derivedEnrollment.body.actor_id,
        derivedEnrollment.body.actor_public_key,
        requestDigest,
        new TextDecoder("utf-8", { fatal: true }).decode(
          request.canonicalRequestBytes,
        ),
        request.createdAt,
      ],
    });
    return this.followerActorEnrollmentContext().request!;
  }

  async installFollowerActorEnrollment(
    input: LibraryCoreInstallFollowerActorEnrollmentV2,
  ): Promise<LibraryCoreFollowerActorEnrollmentReceiptV2> {
    const install = parseLibraryCoreInstallFollowerActorEnrollmentV2(input);
    const context = this.followerActorEnrollmentContext();
    if (!context.request) {
      throw new Error("PWA follower actor request is unavailable");
    }
    if (context.request.state === "enrolled") {
      const rows = this.#database.exec({
        sql: `SELECT canonical_enrollment_certificate, actor_chain_genesis,
                     enrolled_at
              FROM library_follower_actor_request
              WHERE singleton_id = 1 AND actor_id = ?1;`,
        bind: [context.request.actorId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (rows.length !== 1) {
        throw new Error("PWA follower enrollment receipt is unavailable");
      }
      const canonicalBytes = new TextEncoder().encode(
        text(rows[0]![0], "PWA follower enrollment certificate"),
      );
      const actorChainGenesis = text(
        rows[0]![1],
        "PWA follower enrollment chain genesis",
      );
      const enrolledAt = safeInteger(
        rows[0]![2],
        "PWA follower enrollment time",
      );
      if (
        enrolledAt !== install.enrolledAt ||
        canonicalBytes.byteLength !==
          install.canonicalCertificateBytes.byteLength ||
        !canonicalBytes.every(
          (byte, index) => byte === install.canonicalCertificateBytes[index],
        ) ||
        !isLibraryCoreLowercaseHex64(actorChainGenesis)
      ) {
        throw new Error("PWA follower enrollment replay changed");
      }
      return Object.freeze({
        actorChainGenesis,
        actorId: context.request.actorId,
        actorPublicKey: context.request.actorPublicKey,
        enrolledAt,
        enrollmentCertificateDigest: context.request.enrollmentRequestDigest,
      });
    }
    const verified = await verifyLibraryCoreActorCapabilityCertificateV2(
      install.canonicalCertificateBytes,
      context.authority,
      {
        digest: coreDigest,
        verifySignature: (verification) =>
          verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
      },
    );
    const certificate = verified.certificate;
    const enrollment = certificate.certificate_body.actor_enrollment_body;
    const capability = certificate.certificate_body.actor_capability_body;
    if (
      enrollment.actor_id !== context.request.actorId ||
      enrollment.actor_public_key !== context.request.actorPublicKey ||
      certificate.certificate_digest !==
        context.request.enrollmentRequestDigest ||
      capability.actor_class !== "editor" ||
      capability.scope.mode !== "library_wide"
    ) {
      throw new Error("PWA follower enrollment changed its request");
    }
    const canonicalCertificate = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(install.canonicalCertificateBytes);
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_actors
                (actor_id, authority_epoch_id, actor_kind, public_key,
                 enrollment_operation_id, enrollment_certificate_digest,
                 canonical_enrollment_certificate, chain_genesis_digest,
                 accepted_counter, accepted_operation_id, accepted_chain_digest,
                 retired_at, created_at, updated_at)
              VALUES (?1, ?2, 'pwa', ?3, ?4, ?5, ?6, ?7,
                      0, NULL, ?7, NULL, ?8, ?8);`,
        bind: [
          enrollment.actor_id,
          enrollment.epoch_id,
          enrollment.actor_public_key,
          enrollment.operation_id,
          certificate.certificate_digest,
          canonicalCertificate,
          verified.actor_chain_genesis,
          install.enrolledAt,
        ],
      });
      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_actor_capabilities
                (capability_id, actor_id, certificate_version, actor_class,
                 scope_mode, scope_kind, scope_id, issuance_identity,
                 retirement_identity, certificate_digest,
                 canonical_certificate, issued_at, retired_at)
              VALUES (?1, ?2, 2, ?3, 'library_wide', NULL, NULL, ?1, ?4,
                      ?5, ?6, ?7, NULL);`,
        bind: [
          capability.issuance_identity,
          enrollment.actor_id,
          capability.actor_class,
          capability.retirement_identity,
          certificate.certificate_digest,
          canonicalCertificate,
          capability.issued_at_ms,
        ],
      });
      for (const mutationId of capability.allowed_operation_types) {
        this.#database.exec({
          sql: `INSERT OR IGNORE INTO library_actor_capability_mutations
                  (capability_id, mutation_id) VALUES (?1, ?2);`,
          bind: [capability.issuance_identity, mutationId],
        });
      }
      for (const queryId of capability.allowed_query_ids) {
        this.#database.exec({
          sql: `INSERT OR IGNORE INTO library_actor_capability_queries
                  (capability_id, query_id) VALUES (?1, ?2);`,
          bind: [capability.issuance_identity, queryId],
        });
      }
      this.#database.exec({
        sql: `UPDATE library_follower_actor_request
              SET enrollment_certificate_digest = ?1,
                  canonical_enrollment_certificate = ?2,
                  actor_chain_genesis = ?3, enrolled_at = ?4
              WHERE singleton_id = 1 AND actor_id = ?5
                AND enrollment_request_digest = ?1;`,
        bind: [
          certificate.certificate_digest,
          canonicalCertificate,
          verified.actor_chain_genesis,
          install.enrolledAt,
          enrollment.actor_id,
        ],
      });
      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_intent_actors
                (actor_id, next_counter, previous_operation_id,
                 previous_chain_digest) VALUES (?1, 1, NULL, ?2);`,
        bind: [enrollment.actor_id, verified.actor_chain_genesis],
      });
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
    return Object.freeze({
      actorChainGenesis: verified.actor_chain_genesis,
      actorId: enrollment.actor_id,
      actorPublicKey: enrollment.actor_public_key,
      enrolledAt: install.enrolledAt,
      enrollmentCertificateDigest: certificate.certificate_digest,
    });
  }

  followerMutationContext(): LibraryCoreFollowerMutationContextV1 {
    const rows = this.#database.exec({
      sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                   a.actor_id, a.public_key,
                   COALESCE(i.next_counter, a.accepted_counter + 1),
                   COALESCE(i.previous_operation_id, a.accepted_operation_id),
                   COALESCE(i.previous_chain_digest, a.accepted_chain_digest)
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            JOIN library_follower_actor_request AS request
              ON request.singleton_id = 1
             AND request.library_id = m.library_id
             AND request.authority_epoch_id = e.epoch_id
             AND request.enrollment_certificate_digest IS NOT NULL
            JOIN library_actors AS a
              ON a.actor_id = request.actor_id
             AND a.authority_epoch_id = e.epoch_id
             AND a.retired_at IS NULL
            LEFT JOIN library_intent_actors AS i ON i.actor_id = a.actor_id
            WHERE m.singleton_id = 1
              AND EXISTS (
                SELECT 1 FROM library_actor_capabilities AS capability
                WHERE capability.actor_id = a.actor_id
                  AND capability.retired_at IS NULL
              );`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA follower mutation context is unavailable");
    }
    const row = rows[0]!;
    const epochId = text(row[2], "PWA follower mutation epoch ID");
    const frontierRows = this.#database.exec({
      sql: `SELECT actor_id, accepted_counter, accepted_operation_id,
                   accepted_chain_digest
            FROM library_authority_frontier
            WHERE epoch_id = ?1 ORDER BY ordinal;`,
      bind: [epochId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    return parseLibraryCoreFollowerMutationContextV1({
      actor_id: text(row[3], "PWA follower mutation actor ID"),
      actor_public_key: text(row[4], "PWA follower mutation actor key"),
      epoch: safeInteger(row[1], "PWA follower mutation epoch"),
      epoch_id: epochId,
      library_id: text(row[0], "PWA follower mutation Library ID"),
      next_actor_sequence: safeInteger(
        row[5],
        "PWA follower mutation next sequence",
      ),
      observed_frontier: frontierRows.map((tip) => ({
        actor_id: text(tip[0], "PWA follower frontier actor ID"),
        chain_digest: text(tip[3], "PWA follower frontier chain digest"),
        operation_id: text(tip[2], "PWA follower frontier operation ID"),
        sequence: safeInteger(tip[1], "PWA follower frontier sequence"),
      })),
      previous_actor_chain_digest: text(
        row[7],
        "PWA follower mutation previous chain digest",
      ),
      previous_actor_operation_id: nullableText(
        row[6],
        "PWA follower mutation previous operation ID",
      ),
      schema_version: 1,
    });
  }

  followerTransportContext(): LibraryCoreFollowerTransportContextV2 {
    const rows = this.#database.exec({
      sql: `SELECT request.actor_id, m.library_id, e.epoch_id,
                   COALESCE(intent_head.next_actor_counter, 1),
                   intent_head.latest_segment_digest,
                   COALESCE(result_head.next_result_sequence, 1),
                   result_head.latest_segment_digest
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            JOIN library_follower_actor_request AS request
              ON request.singleton_id = 1
             AND request.library_id = m.library_id
             AND request.authority_epoch_id = e.epoch_id
             AND request.enrollment_certificate_digest IS NOT NULL
            JOIN library_intent_actors AS actor
              ON actor.actor_id = request.actor_id
            LEFT JOIN library_intent_transport_heads AS intent_head
              ON intent_head.actor_id = request.actor_id
            LEFT JOIN library_result_transport_heads AS result_head
              ON result_head.actor_id = request.actor_id
            WHERE m.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA follower transport context is unavailable");
    }
    const row = rows[0]!;
    return parseLibraryCoreFollowerTransportContextV2({
      actorId: text(row[0], "PWA follower transport actor"),
      libraryId: text(row[1], "PWA follower transport Library"),
      nextIntentActorCounter: safeInteger(
        row[3],
        "PWA follower transport next intent counter",
      ),
      nextResultSequence: safeInteger(
        row[5],
        "PWA follower transport next result sequence",
      ),
      previousIntentSegmentDigest: nullableText(
        row[4],
        "PWA follower transport previous intent digest",
      ),
      previousResultSegmentDigest: nullableText(
        row[6],
        "PWA follower transport previous result digest",
      ),
      schemaVersion: 2,
      storageEpochId: text(row[2], "PWA follower transport storage epoch"),
    });
  }

  pageFollowerTransport(
    input: LibraryCoreFollowerTransportPageRequestV2,
  ): LibraryCoreFollowerTransportPageResponseV2 {
    const request = parseLibraryCoreFollowerTransportPageRequestV2(input);
    const rows = this.#database.exec({
      sql: `SELECT member.actor_counter, member.canonical_member
            FROM library_intent_members AS member
            JOIN library_intent_transactions AS intent
              ON intent.transaction_id = member.transaction_id
             AND intent.actor_id = member.actor_id
            WHERE member.actor_id = ?1
              AND member.actor_counter >= ?2
              AND intent.state IN ('pending', 'published')
            ORDER BY member.actor_counter
            LIMIT ?3;`,
      bind: [request.actorId, request.firstActorCounter, request.limit + 1],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const canonicalEnvelopes: Uint8Array[] = [];
    let canonicalBytes = 0;
    let stoppedForBytes = false;
    for (const [index, row] of rows.slice(0, request.limit).entries()) {
      const counter = safeInteger(
        row[0],
        "PWA follower transport actor counter",
      );
      if (counter !== request.firstActorCounter + index) {
        throw new Error("PWA follower transport actor chain has a gap");
      }
      const envelope = bytes(row[1], "PWA follower transport envelope");
      if (
        canonicalBytes + envelope.byteLength >
        LIBRARY_CORE_FOLLOWER_TRANSPORT_PAGE_CANONICAL_BYTE_LIMIT
      ) {
        stoppedForBytes = true;
        break;
      }
      canonicalEnvelopes.push(envelope);
      canonicalBytes += envelope.byteLength;
    }
    return parseLibraryCoreFollowerTransportPageResponseV2({
      actorId: request.actorId,
      canonicalEnvelopes,
      done: !stoppedForBytes && rows.length <= request.limit,
      firstActorCounter: request.firstActorCounter,
      lastActorCounter:
        canonicalEnvelopes.length === 0
          ? null
          : request.firstActorCounter + canonicalEnvelopes.length - 1,
      schemaVersion: 2,
    });
  }

  async commitFollowerIntent(
    input: LibraryCoreFollowerIntentCommitV1,
  ): Promise<LibraryCoreFollowerIntentCommitResultV1> {
    const commit = parseLibraryCoreFollowerIntentCommitV1(input);
    const firstCandidate = decodeLibraryCoreCanonicalValue(
      commit.envelopeBytes[0]!,
    );
    if (
      firstCandidate === null ||
      typeof firstCandidate !== "object" ||
      Array.isArray(firstCandidate)
    ) {
      throw new TypeError("follower intent envelope is not a canonical record");
    }
    const firstRecord = firstCandidate as Readonly<
      Record<string, LibraryCoreCanonicalValue>
    >;
    if (
      typeof firstRecord.transaction_id !== "string" ||
      typeof firstRecord.actor_id !== "string"
    ) {
      throw new TypeError("follower intent envelope identity is invalid");
    }
    const exactRetry = this.#followerIntentRetry(
      firstRecord.transaction_id,
      commit.envelopeBytes,
    );
    if (exactRetry !== null) return exactRetry;

    const actorRows = this.#database.exec({
      sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                   a.actor_id, a.public_key,
                   COALESCE(i.next_counter, a.accepted_counter + 1),
                   COALESCE(i.previous_operation_id, a.accepted_operation_id),
                   COALESCE(i.previous_chain_digest, a.accepted_chain_digest)
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            JOIN library_actors AS a ON a.actor_id = ?1
              AND a.authority_epoch_id = e.epoch_id AND a.retired_at IS NULL
            LEFT JOIN library_intent_actors AS i ON i.actor_id = a.actor_id
            WHERE m.singleton_id = 1;`,
      bind: [firstRecord.actor_id],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (actorRows.length !== 1) {
      throw new Error(
        "follower intent actor is unavailable in the active epoch",
      );
    }
    const actor = actorRows[0]!;
    const actorState = Object.freeze({
      actor_id: text(actor[3], "follower intent actor ID"),
      actor_public_key: text(actor[4], "follower intent actor public key"),
      epoch: safeInteger(actor[1], "follower intent epoch"),
      epoch_id: text(actor[2], "follower intent epoch ID"),
      library_id: text(actor[0], "follower intent Library ID"),
      next_actor_sequence: safeInteger(
        actor[5],
        "follower intent next counter",
      ),
      previous_actor_operation_id: nullableText(
        actor[6],
        "follower intent previous operation",
      ),
      previous_actor_chain_digest: text(
        actor[7],
        "follower intent previous chain digest",
      ),
    }) as LibraryCoreAcceptedActorStateV1;
    const verified = await verifyLibraryCoreOperationTransactionV1(
      commit.envelopeBytes,
      actorState,
      {
        digest: (domain, value) =>
          sha256LowerHex(
            encodeLibraryCoreDigestInput(
              domain,
              value as LibraryCoreCanonicalValue,
            ),
          ),
        verifySignature: (verification) =>
          verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
      },
    );
    const transactionProgram = sqliteMutationProgram(
      verified.members[0]!.envelope.operation_type,
    );
    if (
      verified.members.length > transactionProgram.maximumMembers ||
      verified.members.some(
        (member) =>
          member.envelope.operation_type !==
            verified.members[0]!.envelope.operation_type ||
          member.envelope.entity_type !== transactionProgram.entityType,
      )
    ) {
      throw new TypeError(
        "follower intent transaction exceeds its registered mutation program",
      );
    }
    const effects = verified.members.flatMap((member, memberIndex) =>
      libraryCoreOptimisticFieldsForEnvelopeV1(member.envelope).map((effect) =>
        Object.freeze({ effect, member, memberIndex }),
      ),
    );
    const canonicalTransaction = encodeLibraryCoreCanonicalValue(
      verified.transaction_body as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: 131_072 },
    );
    const committedAt = this.#now();
    if (!Number.isSafeInteger(committedAt) || committedAt < 0) {
      throw new Error("follower intent clock is invalid");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const retryInsideTransaction = this.#followerIntentRetry(
        verified.transaction_body.transaction_id,
        commit.envelopeBytes,
      );
      if (retryInsideTransaction !== null) {
        this.#database.exec("COMMIT;");
        return retryInsideTransaction;
      }
      const current = this.#database.exec({
        sql: `SELECT a.accepted_counter, a.accepted_operation_id,
                     a.accepted_chain_digest, i.next_counter,
                     i.previous_operation_id, i.previous_chain_digest,
                     m.library_id, e.epoch_number, e.epoch_id, a.public_key
              FROM library_meta AS m
              JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
              JOIN library_active_authority AS active
                ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
              JOIN library_actors AS a ON a.actor_id = ?1
                AND a.authority_epoch_id = e.epoch_id
              LEFT JOIN library_intent_actors AS i ON i.actor_id = a.actor_id
              WHERE a.actor_id = ?1 AND a.retired_at IS NULL;`,
        bind: [actorState.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (current.length !== 1) {
        throw new Error("follower intent actor changed during verification");
      }
      const tip = current[0]!;
      if (
        text(tip[6], "current follower Library ID") !== actorState.library_id ||
        safeInteger(tip[7], "current follower epoch") !== actorState.epoch ||
        text(tip[8], "current follower epoch ID") !== actorState.epoch_id ||
        text(tip[9], "current follower actor public key") !==
          actorState.actor_public_key
      ) {
        throw new Error(
          "follower intent authority changed during verification",
        );
      }
      const nextCounter =
        tip[3] === null
          ? safeInteger(tip[0], "follower actor accepted counter") + 1
          : safeInteger(tip[3], "follower actor local next counter");
      const previousOperation =
        tip[3] === null
          ? nullableText(tip[1], "follower actor accepted operation")
          : nullableText(tip[4], "follower actor local operation");
      const previousDigest =
        tip[3] === null
          ? text(tip[2], "follower actor accepted digest")
          : text(tip[5], "follower actor local digest");
      if (
        nextCounter !== actorState.next_actor_sequence ||
        previousOperation !== actorState.previous_actor_operation_id ||
        previousDigest !== actorState.previous_actor_chain_digest
      ) {
        throw new Error(
          "follower intent actor tip changed during verification",
        );
      }
      for (const member of verified.members) {
        const envelope = member.envelope;
        const allowed = safeInteger(
          this.#database.exec({
            sql: `SELECT count(*)
                  FROM library_actor_capabilities AS c
                  JOIN library_actor_capability_mutations AS m
                    ON m.capability_id = c.capability_id
                  WHERE c.actor_id = ?1 AND c.retired_at IS NULL
                    AND m.mutation_id = ?2
                    AND (c.scope_mode <> 'bounded'
                      OR (c.scope_kind = ?3 AND c.scope_id = ?4));`,
            bind: [
              envelope.actor_id,
              envelope.operation_type,
              envelope.entity_type,
              envelope.entity_id,
            ],
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower intent capability count",
        );
        if (allowed < 1) {
          throw new Error(
            `follower actor capability denies ${envelope.operation_type}`,
          );
        }
        const program =
          LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS[
            envelope.operation_type as keyof typeof LIBRARY_CORE_SQLITE_MUTATION_PROGRAMS
          ];
        if (!program) {
          throw new Error(
            `follower intent mutation program is absent for ${envelope.operation_type}`,
          );
        }
        const targetExists = safeInteger(
          this.#database.exec({
            sql: program.targetExistsSql,
            bind: program.targetExistsSql.includes("?1")
              ? [envelope.entity_id]
              : [],
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower optimistic target count",
        );
        if (program.requiresExistingTarget && targetExists !== 1) {
          throw new Error("follower optimistic target is unavailable");
        }
      }
      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_intent_actors
                (actor_id, next_counter, previous_operation_id, previous_chain_digest)
              VALUES (?1, ?2, ?3, ?4);`,
        bind: [
          actorState.actor_id,
          actorState.next_actor_sequence,
          actorState.previous_actor_operation_id,
          actorState.previous_actor_chain_digest,
        ],
      });
      const firstEnvelope = verified.members[0]!.envelope;
      const lastEnvelope = verified.members.at(-1)!.envelope;
      this.#database.exec({
        sql: `INSERT INTO library_intent_transactions
                (transaction_id, transaction_digest, actor_id, member_count,
                 intent_epoch, intent_epoch_id, first_counter, last_counter,
                 previous_operation_id,
                 previous_chain_digest, ending_operation_id,
                 ending_chain_digest, canonical_member_bytes,
                 canonical_transaction, state, created_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                      ?13, ?14, 'pending', ?15);`,
        bind: [
          verified.transaction_body.transaction_id,
          verified.transaction_digest,
          actorState.actor_id,
          verified.members.length,
          firstEnvelope.epoch,
          firstEnvelope.epoch_id,
          firstEnvelope.actor_sequence,
          lastEnvelope.actor_sequence,
          firstEnvelope.previous_actor_operation_id,
          firstEnvelope.previous_actor_chain_digest,
          lastEnvelope.operation_id,
          lastEnvelope.actor_chain_digest,
          verified.canonical_envelope_bytes,
          canonicalTransaction,
          committedAt,
        ],
      });
      verified.members.forEach((member, memberIndex) => {
        const envelope = member.envelope;
        this.#database.exec({
          sql: `INSERT INTO library_intent_members
                  (transaction_id, actor_id, member_index, operation_id, actor_counter,
                   mutation_id, entity_type, entity_id, canonical_member,
                   member_digest)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);`,
          bind: [
            verified.transaction_body.transaction_id,
            actorState.actor_id,
            memberIndex,
            envelope.operation_id,
            envelope.actor_sequence,
            envelope.operation_type,
            envelope.entity_type,
            envelope.entity_id,
            commit.envelopeBytes[memberIndex]!,
            member.member_digest,
          ],
        });
      });
      for (const { effect, member, memberIndex } of effects) {
        this.#database.exec({
          sql: `INSERT INTO library_optimistic_fields
                  (transaction_id, member_index, actor_id, actor_counter,
                   entity_type, entity_id, field_path, value_type,
                   boolean_value, integer_value, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);`,
          bind: [
            verified.transaction_body.transaction_id,
            memberIndex,
            member.envelope.actor_id,
            member.envelope.actor_sequence,
            effect.entityType,
            effect.entityId,
            effect.fieldPath,
            effect.valueType,
            effect.valueType === "boolean"
              ? effect.value === true
                ? 1
                : 0
              : null,
            effect.valueType === "integer" ? effect.value : null,
            effect.createdAt,
          ],
        });
      }
      this.#database.exec({
        sql: `UPDATE library_intent_actors
              SET next_counter = ?2, previous_operation_id = ?3,
                  previous_chain_digest = ?4
              WHERE actor_id = ?1 AND next_counter = ?5
                AND previous_operation_id IS ?6
                AND previous_chain_digest = ?7;`,
        bind: [
          actorState.actor_id,
          lastEnvelope.actor_sequence + 1,
          lastEnvelope.operation_id,
          lastEnvelope.actor_chain_digest,
          actorState.next_actor_sequence,
          actorState.previous_actor_operation_id,
          actorState.previous_actor_chain_digest,
        ],
      });
      if (
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower intent actor tip update",
        ) !== 1
      ) {
        throw new Error("follower intent actor tip compare-and-swap failed");
      }
      this.#database.exec("COMMIT;");
      return Object.freeze({
        actorId: actorState.actor_id,
        firstCounter: firstEnvelope.actor_sequence,
        lastCounter: lastEnvelope.actor_sequence,
        memberCount: verified.members.length,
        optimisticFieldCount: effects.length,
        state: "pending",
        transactionId: verified.transaction_body.transaction_id,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  pageFollowerIntents(
    input: LibraryCoreFollowerIntentPageRequestV1,
  ): LibraryCoreFollowerIntentPageResponseV1 {
    const request = parseLibraryCoreFollowerIntentPageRequestV1(input);
    if (request.cursor !== null) {
      const cursorRows = this.#database.exec({
        sql: `SELECT operation_id, transaction_id
              FROM library_intent_members
              WHERE actor_id = ?1 AND actor_counter = ?2;`,
        bind: [request.actorId, request.cursor.actorCounter],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        cursorRows.length !== 1 ||
        text(cursorRows[0]![0], "follower intent cursor operation") !==
          request.cursor.operationId ||
        text(cursorRows[0]![1], "follower intent cursor transaction") !==
          request.cursor.transactionId
      ) {
        throw new Error(
          "follower intent page cursor does not name a stored member",
        );
      }
    }
    const rows = this.#database.exec({
      sql: `SELECT member.actor_counter, member.operation_id,
                   member.transaction_id, member.member_index,
                   member.canonical_member, intent.transaction_digest,
                   intent.intent_epoch, intent.intent_epoch_id,
                   intent.member_count, intent.state
            FROM library_intent_members AS member
            JOIN library_intent_transactions AS intent
              ON intent.transaction_id = member.transaction_id
             AND intent.actor_id = member.actor_id
            WHERE member.actor_id = ?1
              AND member.actor_counter > ?2
              AND intent.state IN ('pending', 'published')
            ORDER BY member.actor_counter
            LIMIT ?3;`,
      bind: [
        request.actorId,
        request.cursor?.actorCounter ?? 0,
        request.limit + 1,
      ],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const records: Array<
      LibraryCoreFollowerIntentPageResponseV1["records"][number]
    > = [];
    let stoppedForBytes = false;
    for (const row of rows.slice(0, request.limit)) {
      const state = text(row[9], "follower intent state");
      if (state !== "pending" && state !== "published") {
        throw new Error("follower intent page contains a resolved transaction");
      }
      const candidate = Object.freeze({
        actorCounter: safeInteger(row[0], "follower intent actor counter"),
        actorId: request.actorId,
        canonicalEnvelopeJson: strictUtf8Decoder.decode(
          bytes(row[4], "follower intent canonical member"),
        ),
        intentEpoch: safeInteger(row[6], "follower intent epoch"),
        intentEpochId: text(row[7], "follower intent epoch ID"),
        memberCount: safeInteger(row[8], "follower intent member count"),
        memberIndex: safeInteger(row[3], "follower intent member index"),
        operationId: text(row[1], "follower intent operation ID"),
        state,
        transactionDigest: text(row[5], "follower intent transaction digest"),
        transactionId: text(row[2], "follower intent transaction ID"),
      });
      const candidateRecords = [...records, candidate];
      const candidateResponse = {
        actorId: request.actorId,
        done: false,
        nextCursor: {
          actorCounter: candidate.actorCounter,
          operationId: candidate.operationId,
          transactionId: candidate.transactionId,
        },
        records: candidateRecords,
        schemaVersion: 1,
      };
      if (
        textEncoder.encode(JSON.stringify(candidateResponse)).byteLength >
        LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES
      ) {
        if (records.length === 0) {
          throw new Error(
            "one follower intent record exceeds the page boundary",
          );
        }
        stoppedForBytes = true;
        break;
      }
      records.push(candidate);
    }
    const last = records.at(-1);
    return parseLibraryCoreFollowerIntentPageResponseV1({
      actorId: request.actorId,
      done:
        !stoppedForBytes &&
        rows.length <= request.limit &&
        records.length === rows.length,
      nextCursor:
        last === undefined
          ? null
          : {
              actorCounter: last.actorCounter,
              operationId: last.operationId,
              transactionId: last.transactionId,
            },
      records,
      schemaVersion: 1,
    });
  }

  publishFollowerIntent(
    input: LibraryCoreFollowerIntentPublicationV1,
  ): LibraryCoreFollowerIntentPublicationReceiptV1 {
    const publication = parseLibraryCoreFollowerIntentPublicationV1(input);
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.#database.exec({
        sql: `SELECT actor_id, transaction_digest, state, published_at, created_at
              FROM library_intent_transactions WHERE transaction_id = ?1;`,
        bind: [publication.transactionId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (rows.length !== 1) {
        throw new Error("follower intent publication transaction is missing");
      }
      const row = rows[0]!;
      if (
        text(row[0], "follower intent publication actor") !==
          publication.actorId ||
        text(row[1], "follower intent publication digest") !==
          publication.transactionDigest
      ) {
        throw new Error("follower intent publication identity was reused");
      }
      const state = text(row[2], "follower intent publication state");
      const storedPublishedAt = nullableInteger(
        row[3],
        "follower intent publication time",
      );
      const createdAt = safeInteger(
        row[4],
        "follower intent publication creation time",
      );
      if (publication.publishedAt < createdAt) {
        throw new Error("follower intent publication predates its transaction");
      }
      if (state === "published") {
        if (storedPublishedAt !== publication.publishedAt) {
          throw new Error("follower intent publication identity was reused");
        }
      } else if (state === "pending" && storedPublishedAt === null) {
        this.#database.exec({
          sql: `UPDATE library_intent_transactions
                SET state = 'published', published_at = ?2
                WHERE transaction_id = ?1 AND state = 'pending'
                  AND published_at IS NULL;`,
          bind: [publication.transactionId, publication.publishedAt],
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "follower intent publication change",
          ) !== 1
        ) {
          throw new Error("follower intent publication changed concurrently");
        }
      } else {
        throw new Error("resolved follower intent cannot be published");
      }
      this.#database.exec("COMMIT;");
      return Object.freeze({
        actorId: publication.actorId,
        publishedAt: publication.publishedAt,
        state: "published",
        transactionId: publication.transactionId,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  publishNormalizedFollowerIntentTransport(
    input: LibraryCoreNormalizedIntentTransportPublicationV2,
  ): LibraryCoreNormalizedIntentTransportPublicationReceiptV2 {
    const publication =
      parseLibraryCoreNormalizedIntentTransportPublicationV2(input);
    const { header, reference } = publication;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const authorityRows = this.#database.exec({
        sql: `SELECT meta.library_id, meta.authority_epoch, intent.actor_id
              FROM library_meta AS meta
              JOIN library_active_authority AS active
                ON active.library_id = meta.library_id
               AND active.epoch_id = meta.authority_epoch
              JOIN library_intent_actors AS intent ON intent.actor_id = ?1
              WHERE meta.singleton_id = 1;`,
        bind: [header.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        authorityRows.length !== 1 ||
        text(authorityRows[0]![0], "intent transport Library") !==
          header.library_id ||
        text(authorityRows[0]![1], "intent transport epoch") !==
          header.storage_epoch_id ||
        text(authorityRows[0]![2], "intent transport actor") !== header.actor_id
      ) {
        throw new Error("normalized intent transport authority changed");
      }
      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_intent_transport_heads
                (actor_id, library_id, storage_epoch_id, next_actor_counter,
                 latest_segment_digest)
              VALUES (?1, ?2, ?3, 1, NULL);`,
        bind: [header.actor_id, header.library_id, header.storage_epoch_id],
      });
      const headRows = this.#database.exec({
        sql: `SELECT library_id, storage_epoch_id, next_actor_counter,
                     latest_segment_digest
              FROM library_intent_transport_heads WHERE actor_id = ?1;`,
        bind: [header.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (headRows.length !== 1) {
        throw new Error("normalized intent transport head is unavailable");
      }
      const head = headRows[0]!;
      if (
        text(head[0], "intent transport head Library") !== header.library_id ||
        text(head[1], "intent transport head epoch") !== header.storage_epoch_id
      ) {
        throw new Error("normalized intent transport head identity changed");
      }
      const existingRows = this.#database.exec({
        sql: `SELECT last_actor_counter, previous_segment_digest,
                     semantic_segment_digest, stored_segment_digest, object_key,
                     transport_object_id, published_at,
                     published_transaction_count
              FROM library_intent_transport_segments
              WHERE actor_id = ?1 AND first_actor_counter = ?2;`,
        bind: [header.actor_id, header.first_actor_counter],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (existingRows.length > 1) {
        throw new Error("normalized intent transport receipt is ambiguous");
      }
      if (existingRows.length === 1) {
        const existing = existingRows[0]!;
        if (
          safeInteger(existing[0], "intent transport last counter") !==
            header.last_actor_counter ||
          nullableText(existing[1], "intent transport previous digest") !==
            header.previous_segment_digest ||
          text(existing[2], "intent transport semantic digest") !==
            header.segment_digest ||
          text(existing[3], "intent transport stored digest") !==
            reference.descriptor.contentDigest ||
          text(existing[4], "intent transport object key") !==
            reference.descriptor.objectKey ||
          text(existing[5], "intent transport object ID") !==
            reference.transportObjectId ||
          safeInteger(existing[6], "intent transport publication time") !==
            publication.publishedAt
        ) {
          throw new Error("normalized intent transport replay changed");
        }
        const publishedCount = safeInteger(
          existing[7],
          "intent transport published transaction count",
        );
        this.#database.exec("COMMIT;");
        return Object.freeze({
          actorId: header.actor_id,
          firstActorCounter: header.first_actor_counter,
          lastActorCounter: header.last_actor_counter,
          newlyPublishedTransactionCount: publishedCount,
          nextActorCounter: header.last_actor_counter + 1,
          publishedAt: publication.publishedAt,
          semanticSegmentDigest: header.segment_digest,
          storedSegmentDigest: reference.descriptor.contentDigest,
        });
      }
      if (
        safeInteger(head[2], "intent transport next counter") !==
          header.first_actor_counter ||
        nullableText(head[3], "intent transport latest digest") !==
          header.previous_segment_digest
      ) {
        throw new Error(
          "normalized intent transport page does not extend its head",
        );
      }
      const storedCount = safeInteger(
        this.#database.exec({
          sql: `SELECT count(*)
                FROM library_intent_members AS member
                JOIN library_intent_transactions AS intent
                  ON intent.transaction_id = member.transaction_id
                 AND intent.actor_id = member.actor_id
                WHERE member.actor_id = ?1
                  AND member.actor_counter BETWEEN ?2 AND ?3
                  AND intent.state IN ('pending', 'published');`,
          bind: [
            header.actor_id,
            header.first_actor_counter,
            header.last_actor_counter,
          ],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "intent transport stored record count",
      );
      if (storedCount !== header.record_count) {
        throw new Error(
          "normalized intent transport range is not fully durable",
        );
      }
      const publishableRows = this.#database.exec({
        sql: `SELECT count(*), max(created_at)
              FROM library_intent_transactions
              WHERE actor_id = ?1 AND state = 'pending'
                AND last_counter <= ?2;`,
        bind: [header.actor_id, header.last_actor_counter],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const publishedCount = safeInteger(
        publishableRows[0]![0],
        "intent transport publishable count",
      );
      const latestCreatedAt = nullableInteger(
        publishableRows[0]![1],
        "intent transport latest creation time",
      );
      if (
        latestCreatedAt !== null &&
        publication.publishedAt < latestCreatedAt
      ) {
        throw new Error(
          "normalized intent transport publication predates its transaction",
        );
      }
      this.#database.exec({
        sql: `INSERT INTO library_intent_transport_segments
                (actor_id, first_actor_counter, last_actor_counter,
                 previous_segment_digest, semantic_segment_digest,
                 stored_segment_digest, object_key, transport_object_id,
                 published_at, published_transaction_count)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);`,
        bind: [
          header.actor_id,
          header.first_actor_counter,
          header.last_actor_counter,
          header.previous_segment_digest,
          header.segment_digest,
          reference.descriptor.contentDigest,
          reference.descriptor.objectKey,
          reference.transportObjectId,
          publication.publishedAt,
          publishedCount,
        ],
      });
      this.#database.exec({
        sql: `UPDATE library_intent_transactions
              SET state = 'published', published_at = ?3
              WHERE actor_id = ?1 AND state = 'pending'
                AND last_counter <= ?2;`,
        bind: [
          header.actor_id,
          header.last_actor_counter,
          publication.publishedAt,
        ],
      });
      const changed = safeInteger(
        this.#database.exec({
          sql: "SELECT changes();",
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "intent transport published transaction count",
      );
      if (changed !== publishedCount) {
        throw new Error(
          "normalized intent transport publication count changed",
        );
      }
      const nextActorCounter = header.last_actor_counter + 1;
      this.#database.exec({
        sql: `UPDATE library_intent_transport_heads
              SET next_actor_counter = ?2, latest_segment_digest = ?3
              WHERE actor_id = ?1 AND next_actor_counter = ?4
                AND latest_segment_digest IS ?5;`,
        bind: [
          header.actor_id,
          nextActorCounter,
          reference.descriptor.contentDigest,
          header.first_actor_counter,
          header.previous_segment_digest,
        ],
      });
      if (
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "intent transport head update",
        ) !== 1
      ) {
        throw new Error(
          "normalized intent transport head changed concurrently",
        );
      }
      this.#database.exec("COMMIT;");
      return Object.freeze({
        actorId: header.actor_id,
        firstActorCounter: header.first_actor_counter,
        lastActorCounter: header.last_actor_counter,
        newlyPublishedTransactionCount: publishedCount,
        nextActorCounter,
        publishedAt: publication.publishedAt,
        semanticSegmentDigest: header.segment_digest,
        storedSegmentDigest: reference.descriptor.contentDigest,
      });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #materializeCanonicalOperationMembers(
    canonicalMembers: readonly Uint8Array[],
    resolvedAt: number,
  ): void {
    if (canonicalMembers.length === 0) {
      throw new Error("accepted operation transaction has no members");
    }
    for (const value of canonicalMembers) {
      const decoded = decodeLibraryCoreCanonicalValue(value);
      if (
        decoded === null ||
        typeof decoded !== "object" ||
        Array.isArray(decoded)
      ) {
        throw new Error("accepted follower intent member is not canonical");
      }
      const envelope = decoded as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      const canonicalText = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): string => {
        if (typeof value !== "string") {
          throw new Error(`${label} is invalid`);
        }
        return value;
      };
      const canonicalSafeInteger = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): number => {
        if (typeof value !== "number" || !Number.isSafeInteger(value)) {
          throw new Error(`${label} is invalid`);
        }
        return value;
      };
      const operationType = canonicalText(
        envelope.operation_type,
        "accepted follower operation type",
      );
      const entityType = canonicalText(
        envelope.entity_type,
        "accepted follower entity type",
      );
      const entityId = canonicalText(
        envelope.entity_id,
        "accepted follower entity ID",
      );
      const actorId = canonicalText(
        envelope.actor_id,
        "accepted follower actor ID",
      );
      const actorSequence = canonicalSafeInteger(
        envelope.actor_sequence,
        "accepted follower actor sequence",
      );
      const operationId = canonicalText(
        envelope.operation_id,
        "accepted follower operation ID",
      );
      if (
        actorSequence < 1 ||
        envelope.payload === null ||
        typeof envelope.payload !== "object" ||
        Array.isArray(envelope.payload)
      ) {
        throw new Error("accepted follower intent materializer is unavailable");
      }
      const program = sqliteMutationProgram(operationType);
      if (entityType !== program.entityType) {
        throw new Error("accepted follower intent entity type is invalid");
      }
      const payload = envelope.payload as Readonly<
        Record<string, LibraryCoreCanonicalValue>
      >;
      const objectJson = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): string => {
        if (
          value === null ||
          typeof value !== "object" ||
          Array.isArray(value)
        ) {
          throw new Error(`accepted follower ${label} payload is invalid`);
        }
        return JSON.stringify(value);
      };
      const requiredInteger = (
        value: LibraryCoreCanonicalValue | undefined,
        label: string,
      ): number => {
        if (
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0
        ) {
          throw new Error(`accepted follower ${label} is invalid`);
        }
        return value;
      };
      const changed = (): number =>
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "accepted follower materialization change",
        );
      const clockWins = (sourceAt: number): boolean => {
        const clock = this.#database.exec({
          sql: program.clockReadSql,
          bind: [entityId],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (clock.length === 0) return true;
        if (clock.length !== 1) {
          throw new Error("accepted follower intent field clock is invalid");
        }
        const currentAt = safeInteger(clock[0]![0], "field clock time");
        const currentOperation = text(clock[0]![1], "field clock operation ID");
        return (
          sourceAt > currentAt ||
          (sourceAt === currentAt && operationId < currentOperation)
        );
      };
      const writeClock = (sourceAt: number): void => {
        this.#database.exec({
          sql: program.clockWriteSql,
          bind: [entityId, actorId, actorSequence, operationId, sourceAt],
        });
      };

      if (program.payloadKind === "read_at") {
        const readAt = requiredInteger(payload.read_at_ms, "read time");
        const currentValues = this.#database.exec({
          sql: program.currentValueSql,
          bind: [entityId],
          rowMode: 0,
          returnValue: "resultRows",
        });
        if (currentValues.length !== 1) {
          throw new Error("accepted follower read target is unavailable");
        }
        const currentReadAt = nullableInteger(
          currentValues[0],
          "accepted follower current read time",
        );
        const currentClockRows = this.#database.exec({
          sql: program.clockReadSql,
          bind: [entityId],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (
          currentClockRows.length > 1 ||
          (currentReadAt === null) !== (currentClockRows.length === 0) ||
          (currentReadAt !== null &&
            safeInteger(currentClockRows[0]![0], "read field clock time") !==
              currentReadAt)
        ) {
          throw new Error("accepted follower read field clock is inconsistent");
        }
        const wins =
          currentReadAt === null ||
          readAt < currentReadAt ||
          (readAt === currentReadAt &&
            operationId <
              text(
                currentClockRows[0]![1],
                "accepted follower read clock operation",
              ));
        if (wins) {
          this.#database.exec({
            sql: program.materializeSql,
            bind: [readAt, readAt, resolvedAt, entityId],
          });
          if (changed() !== 1) {
            throw new Error("accepted follower read target changed");
          }
          writeClock(readAt);
        }
        continue;
      }

      if (program.payloadKind === "boolean_assignment") {
        const assigned = payload.assigned;
        const assignedAt = requiredInteger(
          payload.assigned_at_ms,
          "assignment time",
        );
        if (typeof assigned !== "boolean") {
          throw new Error("accepted follower assignment value is invalid");
        }
        if (clockWins(assignedAt)) {
          this.#database.exec({
            sql: program.materializeSql,
            bind: [assigned ? 1 : 0, assignedAt, resolvedAt, entityId],
          });
          if (changed() !== 1) {
            throw new Error("accepted follower assignment target changed");
          }
          writeClock(assignedAt);
        }
        continue;
      }

      if (program.payloadKind === "sync_receipt") {
        const syncedAt = requiredInteger(
          payload.synced_at_ms,
          "sync receipt time",
        );
        if (clockWins(syncedAt)) {
          this.#database.exec({
            sql: program.materializeSql,
            bind: [syncedAt, resolvedAt, entityId],
          });
          if (changed() !== 1) {
            throw new Error("accepted follower sync receipt target changed");
          }
          writeClock(syncedAt);
        }
        continue;
      }

      if (program.payloadKind === "friend_replace") {
        const person = payload.person;
        const accounts = payload.accounts;
        if (
          !isLibraryCoreCanonicalRecord(person) ||
          person.id !== entityId ||
          !Array.isArray(accounts) ||
          accounts.some(
            (account) =>
              account === null ||
              typeof account !== "object" ||
              Array.isArray(account) ||
              typeof account.id !== "string" ||
              account.personId !== entityId,
          ) ||
          new Set(accounts.map((account) => String(account.id))).size !==
            accounts.length
        ) {
          throw new Error("accepted follower Friend payload is invalid");
        }
        const payloadJson = JSON.stringify(payload);
        const personJson = JSON.stringify(person);
        this.#database.exec({
          sql: program.materializeSql,
          bind: [entityId, payloadJson],
        });
        if (changed() !== 0) {
          const personProgram = sqliteMutationProgram("person_upsert");
          for (const sql of personProgram.dependentDeleteSql) {
            this.#database.exec({ sql, bind: [entityId] });
          }
          for (const sql of personProgram.dependentInsertSql) {
            this.#database.exec({ sql, bind: [entityId, personJson] });
          }
          for (const sql of program.dependentDeleteSql) {
            this.#database.exec({ sql, bind: [entityId, payloadJson] });
          }
          const accountProgram = sqliteMutationProgram("account_upsert");
          for (const account of accounts) {
            const accountId = String(account.id);
            const accountJson = JSON.stringify(account);
            this.#database.exec({
              sql: accountProgram.materializeSql,
              bind: [accountId, accountJson],
            });
            if (changed() === 0) continue;
            for (const sql of accountProgram.dependentDeleteSql) {
              this.#database.exec({ sql, bind: [accountId] });
            }
            for (const sql of accountProgram.dependentInsertSql) {
              this.#database.exec({
                sql,
                bind: [accountId, accountJson],
              });
            }
          }
        }
        continue;
      }

      if (
        program.payloadKind === "account_upsert" ||
        program.payloadKind === "feed_item_capture_upsert" ||
        program.payloadKind === "person_upsert" ||
        program.payloadKind === "rss_feed_upsert"
      ) {
        const property =
          program.payloadKind === "account_upsert"
            ? "account"
            : program.payloadKind === "feed_item_capture_upsert"
              ? "item"
              : program.payloadKind === "person_upsert"
                ? "person"
                : "feed";
        const canonicalRecord = payload[property];
        const recordJson =
          program.payloadKind === "feed_item_capture_upsert"
            ? JSON.stringify(
                decodeLibraryCoreFractionalNumbersV1(canonicalRecord),
              )
            : objectJson(canonicalRecord, property);
        this.#database.exec({
          sql: program.materializeSql,
          bind:
            program.payloadKind === "account_upsert" ||
            program.payloadKind === "person_upsert"
              ? [entityId, recordJson]
              : [entityId, recordJson, resolvedAt],
        });
        if (changed() !== 0) {
          for (const sql of program.dependentDeleteSql) {
            this.#database.exec({ sql, bind: [entityId] });
          }
          for (const sql of program.dependentInsertSql) {
            this.#database.exec({
              sql,
              bind: [entityId, recordJson],
            });
          }
        }
        continue;
      }

      if (program.payloadKind === "preferences_leaf_assignment") {
        const patchJson = objectJson(payload.updates, "preference patch");
        const bounds = this.#database.exec({
          sql: `SELECT count(*),
                       coalesce(max(length(CAST(fullkey AS BLOB)) + 2), 0),
                       coalesce(max(CASE WHEN type = 'text'
                                         THEN length(CAST(atom AS BLOB))
                                         ELSE 0 END), 0)
                FROM json_tree(?1) WHERE fullkey <> '$';`,
          bind: [patchJson],
          rowMode: "array",
          returnValue: "resultRows",
        });
        const nodeCount = safeInteger(
          bounds[0]?.[0],
          "preference patch node count",
        );
        if (
          bounds.length !== 1 ||
          nodeCount < 1 ||
          nodeCount > 512 ||
          safeInteger(bounds[0]![1], "preference patch path bytes") > 4_096 ||
          safeInteger(bounds[0]![2], "preference patch text bytes") > 8_192
        ) {
          throw new Error("accepted follower preference patch exceeds bounds");
        }
        for (const sql of program.dependentDeleteSql) {
          this.#database.exec({ sql, bind: [patchJson] });
        }
        this.#database.exec({
          sql: program.materializeSql,
          bind: [patchJson, resolvedAt],
        });
        continue;
      }

      if (program.payloadKind === "person_reach_out_append") {
        const loggedAt = requiredInteger(
          payload.logged_at_ms,
          "reach-out time",
        );
        const channel = payload.channel;
        const notes = payload.notes;
        if (
          (channel !== null && typeof channel !== "string") ||
          (notes !== null && typeof notes !== "string")
        ) {
          throw new Error("accepted follower reach-out payload is invalid");
        }
        this.#database.exec({
          sql: program.materializeSql,
          bind: [entityId, operationId, loggedAt, channel, notes],
        });
        for (const sql of program.dependentDeleteSql) {
          this.#database.exec({ sql, bind: [entityId] });
        }
        continue;
      }

      if (program.payloadKind === "remove") {
        const removedAt = requiredInteger(
          payload.removed_at_ms,
          "removal time",
        );
        if (clockWins(removedAt)) {
          for (const sql of program.dependentDeleteSql) {
            this.#database.exec({ sql, bind: [entityId] });
          }
          this.#database.exec({
            sql: program.materializeSql,
            bind: [entityId],
          });
          writeClock(removedAt);
        }
        continue;
      }

      if (
        program.payloadKind === "text_assignment" ||
        program.payloadKind === "nullable_text_assignment"
      ) {
        const assignedAt = requiredInteger(
          payload.assigned_at_ms,
          "assignment time",
        );
        const assignedValue =
          program.payloadKind === "text_assignment"
            ? payload.title
            : payload.person_id;
        if (
          (program.payloadKind === "text_assignment" &&
            typeof assignedValue !== "string") ||
          (program.payloadKind === "nullable_text_assignment" &&
            assignedValue !== null &&
            typeof assignedValue !== "string")
        ) {
          throw new Error("accepted follower assignment payload is invalid");
        }
        if (clockWins(assignedAt)) {
          this.#database.exec({
            sql: program.materializeSql,
            bind: [assignedValue as SqlValue, resolvedAt, entityId],
          });
          if (changed() !== 1) {
            throw new Error("accepted follower assignment target changed");
          }
          writeClock(assignedAt);
        }
        continue;
      }

      throw new Error("accepted follower intent materializer is unavailable");
    }
  }

  async importNormalizedOperationPage(
    input: LibraryCoreNormalizedOperationImportPageV2,
  ): Promise<LibraryCoreNormalizedOperationImportReceiptV2> {
    const imported = parseLibraryCoreNormalizedOperationImportPageV2(input);
    const touchedRevisions = new Set(
      imported.page.records.map((record) => record.sourceRevision),
    );
    const authorityRows = this.#database.exec({
      sql: `SELECT m.library_id, m.authority_epoch, m.source_revision,
                   changes.revision, active.writer_id
            FROM library_meta AS m
            JOIN library_change_state AS changes
              ON changes.singleton_id = m.singleton_id
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id
             AND active.epoch_id = m.authority_epoch
             AND active.active_key = 'active'
            WHERE m.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (authorityRows.length !== 1) {
      throw new Error("normalized operation import authority is unavailable");
    }
    const authority = authorityRows[0]!;
    const initialRevision = safeInteger(
      authority[2],
      "normalized operation import source revision",
    );
    if (
      initialRevision !==
        safeInteger(
          authority[3],
          "normalized operation import change revision",
        ) ||
      text(authority[0], "normalized operation import Library") !==
        imported.snapshot.libraryId ||
      text(authority[1], "normalized operation import epoch") !==
        imported.snapshot.authorityEpoch ||
      text(authority[4], "normalized operation import writer") !==
        imported.snapshot.writerId
    ) {
      throw new Error("normalized operation import authority changed");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const currentRows = this.#database.exec({
        sql: `SELECT m.library_id, m.authority_epoch, m.source_revision,
                     changes.revision, active.writer_id
              FROM library_meta AS m
              JOIN library_change_state AS changes
                ON changes.singleton_id = m.singleton_id
              JOIN library_active_authority AS active
                ON active.library_id = m.library_id
               AND active.epoch_id = m.authority_epoch
               AND active.active_key = 'active'
              WHERE m.singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        currentRows.length !== 1 ||
        text(currentRows[0]![0], "staged operation Library") !==
          imported.snapshot.libraryId ||
        text(currentRows[0]![1], "staged operation epoch") !==
          imported.snapshot.authorityEpoch ||
        text(currentRows[0]![4], "staged operation writer") !==
          imported.snapshot.writerId
      ) {
        throw new Error("normalized operation import authority changed");
      }
      const currentRevision = safeInteger(
        currentRows[0]![2],
        "staged operation source revision",
      );
      if (
        currentRevision !==
        safeInteger(currentRows[0]![3], "staged operation change revision")
      ) {
        throw new Error("normalized operation import revisions disagree");
      }

      for (const record of imported.page.records) {
        const canonicalBytes = Uint8Array.from(
          textEncoder.encode(record.canonicalRecordJson),
        );
        if (record.sourceRevision <= currentRevision) {
          if (record.kind === "accepted_transaction") {
            const applied = this.#database.exec({
              sql: `SELECT tx.transaction_digest, result.result_digest,
                           result.canonical_result
                    FROM library_operation_replication_results AS result
                    JOIN library_transactions AS tx
                      ON tx.transaction_id = result.transaction_id
                    WHERE result.source_revision = ?1
                      AND result.transaction_id = ?2;`,
              bind: [record.sourceRevision, record.transactionId],
              rowMode: "array",
              returnValue: "resultRows",
            });
            if (
              applied.length !== 1 ||
              text(applied[0]![0], "applied transaction digest") !==
                record.transactionDigest ||
              text(applied[0]![1], "applied result digest") !==
                record.recordDigest ||
              !sameBytes(
                bytes(applied[0]![2], "applied canonical result"),
                canonicalBytes,
              )
            ) {
              throw new Error("normalized accepted transaction replay changed");
            }
          } else {
            const applied = this.#database.exec({
              sql: `SELECT tx.transaction_digest, operation.envelope_digest,
                           operation.canonical_envelope
                    FROM library_transactions AS tx
                    JOIN library_operations AS operation
                      ON operation.transaction_id = tx.transaction_id
                    WHERE tx.committed_revision = ?1
                      AND tx.transaction_id = ?2
                      AND operation.member_index = ?3;`,
              bind: [
                record.sourceRevision,
                record.transactionId,
                record.memberIndex,
              ],
              rowMode: "array",
              returnValue: "resultRows",
            });
            if (
              applied.length !== 1 ||
              text(applied[0]![0], "applied operation transaction digest") !==
                record.transactionDigest ||
              text(applied[0]![1], "applied operation digest") !==
                record.recordDigest ||
              !sameBytes(
                bytes(applied[0]![2], "applied canonical operation"),
                canonicalBytes,
              )
            ) {
              throw new Error("normalized operation replay changed");
            }
          }
          continue;
        }

        if (record.kind === "accepted_transaction") {
          const result = parseLibraryCoreFollowerResultEnvelopeV1(
            decodeLibraryCoreCanonicalValue(canonicalBytes, {
              maximumBytes: 131_072,
            }),
          );
          const expectedMemberCount = result.canonical_operation_ids.length;
          if (
            expectedMemberCount < 1 ||
            expectedMemberCount !== result.receipt_ids.length ||
            result.authoritative_source_revision !== record.sourceRevision ||
            result.epoch_id !== imported.snapshot.authorityEpoch ||
            result.library_id !== imported.snapshot.libraryId ||
            result.status !== "accepted"
          ) {
            throw new Error("normalized accepted transaction is incomplete");
          }
          const existing = this.#database.exec({
            sql: `SELECT transaction_id, transaction_digest,
                         authority_epoch_id, writer_id,
                         snapshot_source_revision, expected_member_count,
                         result_digest, canonical_result, received_at
                  FROM library_operation_replication_stages
                  WHERE source_revision = ?1;`,
            bind: [record.sourceRevision],
            rowMode: "array",
            returnValue: "resultRows",
          });
          if (existing.length === 0) {
            this.#database.exec({
              sql: `INSERT INTO library_operation_replication_stages
                      (source_revision, transaction_id, transaction_digest,
                       authority_epoch_id, writer_id,
                       snapshot_source_revision, expected_member_count,
                       result_digest, canonical_result, received_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);`,
              bind: [
                record.sourceRevision,
                record.transactionId,
                record.transactionDigest,
                imported.snapshot.authorityEpoch,
                imported.snapshot.writerId,
                imported.snapshot.sourceRevision,
                expectedMemberCount,
                record.recordDigest,
                canonicalBytes,
                imported.receivedAt,
              ],
            });
          } else {
            const row = existing[0]!;
            if (
              existing.length !== 1 ||
              text(row[0], "staged transaction ID") !== record.transactionId ||
              text(row[1], "staged transaction digest") !==
                record.transactionDigest ||
              text(row[2], "staged authority epoch") !==
                imported.snapshot.authorityEpoch ||
              text(row[3], "staged writer") !== imported.snapshot.writerId ||
              safeInteger(row[4], "staged snapshot revision") !==
                imported.snapshot.sourceRevision ||
              safeInteger(row[5], "staged member count") !==
                expectedMemberCount ||
              text(row[6], "staged result digest") !== record.recordDigest ||
              !sameBytes(
                bytes(row[7], "staged canonical result"),
                canonicalBytes,
              ) ||
              safeInteger(row[8], "staged result received time") !==
                imported.receivedAt
            ) {
              throw new Error("normalized accepted transaction replay changed");
            }
          }
          continue;
        }

        const stage = this.#database.exec({
          sql: `SELECT transaction_id, transaction_digest,
                       expected_member_count
                FROM library_operation_replication_stages
                WHERE source_revision = ?1;`,
          bind: [record.sourceRevision],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (
          stage.length !== 1 ||
          text(stage[0]![0], "operation stage transaction") !==
            record.transactionId ||
          text(stage[0]![1], "operation stage transaction digest") !==
            record.transactionDigest ||
          record.memberIndex >=
            safeInteger(stage[0]![2], "operation stage member count")
        ) {
          throw new Error(
            "normalized operation arrived without its accepted transaction",
          );
        }
        const decoded = decodeLibraryCoreCanonicalValue(canonicalBytes, {
          maximumBytes: 131_072,
        });
        if (!isLibraryCoreCanonicalRecord(decoded)) {
          throw new Error("normalized operation is not a canonical record");
        }
        const operationId = decoded.operation_id;
        if (typeof operationId !== "string") {
          throw new Error("normalized operation ID is invalid");
        }
        const existing = this.#database.exec({
          sql: `SELECT operation_id, envelope_digest, canonical_envelope
                FROM library_operation_replication_stage_members
                WHERE source_revision = ?1 AND member_index = ?2;`,
          bind: [record.sourceRevision, record.memberIndex],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (existing.length === 0) {
          this.#database.exec({
            sql: `INSERT INTO library_operation_replication_stage_members
                    (source_revision, member_index, operation_id,
                     envelope_digest, canonical_envelope)
                  VALUES (?1, ?2, ?3, ?4, ?5);`,
            bind: [
              record.sourceRevision,
              record.memberIndex,
              operationId,
              record.recordDigest,
              canonicalBytes,
            ],
          });
        } else if (
          existing.length !== 1 ||
          text(existing[0]![0], "staged operation ID") !== operationId ||
          text(existing[0]![1], "staged operation digest") !==
            record.recordDigest ||
          !sameBytes(
            bytes(existing[0]![2], "staged canonical operation"),
            canonicalBytes,
          )
        ) {
          throw new Error("normalized operation replay changed");
        }
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    let appliedTransactionCount = 0;
    while (true) {
      const revisionRows = this.#database.exec({
        sql: `SELECT m.source_revision, changes.revision
              FROM library_meta AS m
              JOIN library_change_state AS changes
                ON changes.singleton_id = m.singleton_id
              WHERE m.singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (revisionRows.length !== 1) {
        throw new Error("normalized operation revision is unavailable");
      }
      const previousRevision = safeInteger(
        revisionRows[0]![0],
        "normalized operation previous revision",
      );
      if (
        previousRevision !==
        safeInteger(revisionRows[0]![1], "normalized operation change revision")
      ) {
        throw new Error("normalized operation revisions disagree");
      }
      if (previousRevision === Number.MAX_SAFE_INTEGER) {
        throw new Error("normalized operation revision is exhausted");
      }
      const nextRevision = previousRevision + 1;
      const stageRows = this.#database.exec({
        sql: `SELECT transaction_id, transaction_digest, authority_epoch_id,
                     writer_id, snapshot_source_revision,
                     expected_member_count, result_digest,
                     canonical_result, received_at
              FROM library_operation_replication_stages
              WHERE source_revision = ?1;`,
        bind: [nextRevision],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (stageRows.length === 0) break;
      if (stageRows.length !== 1) {
        throw new Error("normalized operation stage is ambiguous");
      }
      const stage = stageRows[0]!;
      const expectedMemberCount = safeInteger(
        stage[5],
        "normalized operation expected member count",
      );
      const memberRows = this.#database.exec({
        sql: `SELECT member_index, operation_id, envelope_digest,
                     canonical_envelope
              FROM library_operation_replication_stage_members
              WHERE source_revision = ?1 ORDER BY member_index;`,
        bind: [nextRevision],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (memberRows.length < expectedMemberCount) break;
      if (
        memberRows.length !== expectedMemberCount ||
        memberRows.some(
          (row, index) =>
            safeInteger(row[0], "normalized operation member index") !== index,
        )
      ) {
        throw new Error("normalized operation stage membership is invalid");
      }
      const canonicalResult = bytes(
        stage[7],
        "normalized operation canonical result",
      );
      const resultCandidate = parseLibraryCoreFollowerResultEnvelopeV1(
        decodeLibraryCoreCanonicalValue(canonicalResult, {
          maximumBytes: 131_072,
        }),
      );
      const actorRows = this.#database.exec({
        sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                     e.authority_key_id, e.authority_public_key,
                     active.writer_id, actor.actor_id, actor.public_key,
                     actor.accepted_counter, actor.accepted_operation_id,
                     actor.accepted_chain_digest
              FROM library_meta AS m
              JOIN library_authority_epochs AS e
                ON e.epoch_id = m.authority_epoch
              JOIN library_active_authority AS active
                ON active.library_id = m.library_id
               AND active.epoch_id = e.epoch_id
               AND active.active_key = 'active'
              JOIN library_actors AS actor
                ON actor.actor_id = ?1
               AND actor.authority_epoch_id = e.epoch_id
               AND actor.retired_at IS NULL
              WHERE m.singleton_id = 1;`,
        bind: [resultCandidate.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (actorRows.length !== 1) {
        throw new Error("normalized operation actor is unavailable");
      }
      const actor = actorRows[0]!;
      if (
        text(stage[2], "operation stage epoch") !==
          text(actor[2], "active operation epoch") ||
        text(stage[3], "operation stage writer") !==
          text(actor[5], "active operation writer") ||
        safeInteger(stage[4], "operation stage snapshot revision") <
          nextRevision
      ) {
        throw new Error("normalized operation stage authority changed");
      }
      const resultAuthority = Object.freeze({
        authorityKeyId: text(actor[3], "operation result authority key ID"),
        authorityPublicKey: text(
          actor[4],
          "operation result authority public key",
        ),
        epoch: safeInteger(actor[1], "operation result epoch"),
        epochId: text(actor[2], "operation result epoch ID"),
        libraryId: text(actor[0], "operation result Library ID"),
      });
      const verifiedResult = await verifyLibraryCoreFollowerResultV1(
        canonicalResult,
        resultAuthority,
        {
          verifySignature: (verification) =>
            verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
        },
      );
      const acceptedActor = Object.freeze({
        actor_id: text(actor[6], "operation actor ID"),
        actor_public_key: text(actor[7], "operation actor public key"),
        epoch: safeInteger(actor[1], "operation actor epoch"),
        epoch_id: text(actor[2], "operation actor epoch ID"),
        library_id: text(actor[0], "operation actor Library ID"),
        next_actor_sequence:
          safeInteger(actor[8], "operation actor accepted counter") + 1,
        previous_actor_operation_id: nullableText(
          actor[9],
          "operation actor previous operation",
        ),
        previous_actor_chain_digest: text(
          actor[10],
          "operation actor previous chain digest",
        ),
      }) as LibraryCoreAcceptedActorStateV1;
      const canonicalMembers = memberRows.map((row) =>
        bytes(row[3], "normalized canonical operation member"),
      );
      const verified = await verifyLibraryCoreOperationTransactionV1(
        canonicalMembers,
        acceptedActor,
        {
          digest: (domain, value) =>
            sha256LowerHex(
              encodeLibraryCoreDigestInput(
                domain,
                value as LibraryCoreCanonicalValue,
              ),
            ),
          verifySignature: (verification) =>
            verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
        },
      );
      const resultEnvelope = verifiedResult.envelope;
      const first = verified.members[0]!.envelope;
      const last = verified.members[verified.members.length - 1]!.envelope;
      const operationIds = verified.members.map(
        (member) => member.envelope.operation_id,
      );
      const envelopeDigests = verified.members.map(
        (member) => member.envelope_digest,
      );
      if (
        resultEnvelope.status !== "accepted" ||
        resultEnvelope.authoritative_source_revision !== nextRevision ||
        resultEnvelope.transaction_id !==
          text(stage[0], "stage transaction ID") ||
        resultEnvelope.transaction_digest !==
          text(stage[1], "stage transaction digest") ||
        resultEnvelope.transaction_id !== first.transaction_id ||
        resultEnvelope.transaction_digest !== verified.transaction_digest ||
        resultEnvelope.actor_id !== first.actor_id ||
        resultEnvelope.intent_epoch !== first.epoch ||
        resultEnvelope.intent_epoch_id !== first.epoch_id ||
        resultEnvelope.resolved_at_ms < last.created_at_ms ||
        verifiedResult.resultDigest !== text(stage[6], "stage result digest") ||
        resultEnvelope.canonical_operation_ids.length !== operationIds.length ||
        resultEnvelope.canonical_operation_ids.some(
          (operationId, index) => operationId !== operationIds[index],
        ) ||
        resultEnvelope.receipt_ids.length !== envelopeDigests.length ||
        resultEnvelope.receipt_ids.some(
          (receiptId, index) => receiptId !== envelopeDigests[index],
        ) ||
        memberRows.some(
          (row, index) =>
            text(row[1], "staged operation ID") !== operationIds[index] ||
            text(row[2], "staged envelope digest") !== envelopeDigests[index],
        )
      ) {
        throw new Error("normalized operation transaction proof changed");
      }
      const program = sqliteMutationProgram(first.operation_type);
      if (
        verified.members.length > program.maximumMembers ||
        verified.members.some(
          (member) =>
            member.envelope.operation_type !== first.operation_type ||
            member.envelope.entity_type !== program.entityType,
        )
      ) {
        throw new Error("normalized operation transaction exceeds its program");
      }
      for (const member of verified.members) {
        for (const tip of member.envelope.causal_frontier) {
          const tips = this.#database.exec({
            sql: `SELECT actor_id, actor_counter, actor_chain_digest
                  FROM library_operations WHERE operation_id = ?1;`,
            bind: [tip.operation_id],
            rowMode: "array",
            returnValue: "resultRows",
          });
          if (
            tips.length !== 1 ||
            text(tips[0]![0], "causal tip actor") !== tip.actor_id ||
            safeInteger(tips[0]![1], "causal tip counter") !== tip.sequence ||
            text(tips[0]![2], "causal tip chain") !== tip.chain_digest
          ) {
            throw new Error("normalized operation causal tip is unavailable");
          }
        }
      }

      this.#database.exec("BEGIN IMMEDIATE;");
      try {
        const current = this.#database.exec({
          sql: `SELECT m.source_revision, changes.revision,
                       m.library_id, m.authority_epoch, active.writer_id,
                       actor.accepted_counter, actor.accepted_operation_id,
                       actor.accepted_chain_digest
                FROM library_meta AS m
                JOIN library_change_state AS changes
                  ON changes.singleton_id = m.singleton_id
                JOIN library_active_authority AS active
                  ON active.library_id = m.library_id
                 AND active.epoch_id = m.authority_epoch
                 AND active.active_key = 'active'
                JOIN library_actors AS actor
                  ON actor.actor_id = ?1
                 AND actor.authority_epoch_id = m.authority_epoch
                 AND actor.retired_at IS NULL
                WHERE m.singleton_id = 1;`,
          bind: [verified.accepted_actor_state.actor_id],
          rowMode: "array",
          returnValue: "resultRows",
        });
        const stagedAgain = this.#database.exec({
          sql: `SELECT transaction_id, transaction_digest, result_digest,
                       canonical_result,
                       (SELECT count(*)
                          FROM library_operation_replication_stage_members
                         WHERE source_revision = ?1)
                FROM library_operation_replication_stages
                WHERE source_revision = ?1;`,
          bind: [nextRevision],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (
          current.length !== 1 ||
          safeInteger(current[0]![0], "commit source revision") !==
            previousRevision ||
          safeInteger(current[0]![1], "commit change revision") !==
            previousRevision ||
          text(current[0]![2], "commit Library") !==
            verified.accepted_actor_state.library_id ||
          text(current[0]![3], "commit epoch") !==
            verified.accepted_actor_state.epoch_id ||
          text(current[0]![4], "commit writer") !==
            text(stage[3], "stage writer") ||
          safeInteger(current[0]![5], "commit actor counter") !==
            verified.accepted_actor_state.next_actor_sequence - 1 ||
          nullableText(current[0]![6], "commit actor operation") !==
            verified.accepted_actor_state.previous_actor_operation_id ||
          text(current[0]![7], "commit actor chain") !==
            verified.accepted_actor_state.previous_actor_chain_digest ||
          stagedAgain.length !== 1 ||
          text(stagedAgain[0]![0], "commit staged transaction") !==
            resultEnvelope.transaction_id ||
          text(stagedAgain[0]![1], "commit staged digest") !==
            verified.transaction_digest ||
          text(stagedAgain[0]![2], "commit staged result digest") !==
            verifiedResult.resultDigest ||
          !sameBytes(
            bytes(stagedAgain[0]![3], "commit staged result"),
            verifiedResult.canonicalBytes,
          ) ||
          safeInteger(stagedAgain[0]![4], "commit staged member count") !==
            verified.members.length
        ) {
          throw new Error("normalized operation changed during verification");
        }

        this.#database.exec({
          sql: `INSERT INTO library_transactions
                  (transaction_id, transaction_digest, library_id,
                   authority_epoch, actor_id, member_count,
                   first_counter, last_counter, previous_operation_id,
                   previous_chain_digest, committed_operation_id,
                   committed_chain_digest, canonical_member_bytes,
                   previous_revision, committed_revision, committed_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                        ?11, ?12, ?13, ?14, ?15, ?16);`,
          bind: [
            resultEnvelope.transaction_id,
            verified.transaction_digest,
            verified.accepted_actor_state.library_id,
            verified.accepted_actor_state.epoch_id,
            verified.accepted_actor_state.actor_id,
            verified.members.length,
            first.actor_sequence,
            last.actor_sequence,
            first.previous_actor_operation_id,
            first.previous_actor_chain_digest,
            last.operation_id,
            last.actor_chain_digest,
            verified.canonical_envelope_bytes,
            previousRevision,
            nextRevision,
            resultEnvelope.resolved_at_ms,
          ],
        });
        verified.members.forEach((member, memberIndex) => {
          const envelope = member.envelope;
          this.#database.exec({
            sql: `INSERT INTO library_operations
                    (operation_id, transaction_id, member_index, member_count,
                     actor_id, actor_counter, previous_actor_operation_id,
                     previous_actor_chain_digest, actor_chain_digest,
                     member_digest, envelope_digest, mutation_id, entity_type,
                     entity_id, canonical_envelope, committed_at)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                          ?11, ?12, ?13, ?14, ?15, ?16);`,
            bind: [
              envelope.operation_id,
              resultEnvelope.transaction_id,
              memberIndex,
              verified.members.length,
              envelope.actor_id,
              envelope.actor_sequence,
              envelope.previous_actor_operation_id,
              envelope.previous_actor_chain_digest,
              envelope.actor_chain_digest,
              member.member_digest,
              member.envelope_digest,
              envelope.operation_type,
              envelope.entity_type,
              envelope.entity_id,
              canonicalMembers[memberIndex]!,
              resultEnvelope.resolved_at_ms,
            ],
          });
          envelope.causal_frontier.forEach((tip, tipIndex) => {
            this.#database.exec({
              sql: `INSERT INTO library_operation_causal_tips
                      (operation_id, tip_index, actor_id, actor_counter,
                       tip_operation_id, chain_digest)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6);`,
              bind: [
                envelope.operation_id,
                tipIndex,
                tip.actor_id,
                tip.sequence,
                tip.operation_id,
                tip.chain_digest,
              ],
            });
          });
        });
        this.#materializeCanonicalOperationMembers(
          canonicalMembers,
          resultEnvelope.resolved_at_ms,
        );
        verified.members.forEach((member, memberIndex) => {
          const envelope = member.envelope;
          this.#database.exec({
            sql: `INSERT INTO library_receipts
                    (actor_id, operation_id, status, digest, result_text,
                     accepted_at)
                  VALUES (?1, ?2, 'accepted', ?3, ?4, ?5);`,
            bind: [
              envelope.actor_id,
              envelope.operation_id,
              member.envelope_digest,
              JSON.stringify({
                committedRevision: nextRevision,
                operationId: envelope.operation_id,
              }),
              resultEnvelope.resolved_at_ms,
            ],
          });
          this.#database.exec({
            sql: `INSERT INTO library_invalidations
                    (revision, ordinal, topic, entity_id, reset_required)
                  VALUES (?1, ?2, ?3, ?4, 0);`,
            bind: [
              nextRevision,
              memberIndex,
              program.invalidationTopic,
              envelope.entity_id,
            ],
          });
          if (program.payloadKind === "friend_replace") {
            this.#database.exec({
              sql: `INSERT INTO library_invalidations
                      (revision, ordinal, topic, entity_id, reset_required)
                    VALUES (?1, ?2, 'account', NULL, 1);`,
              bind: [nextRevision, verified.members.length + memberIndex],
            });
          }
        });
        this.#database.exec({
          sql: `UPDATE library_actors
                SET accepted_counter = ?1, accepted_operation_id = ?2,
                    accepted_chain_digest = ?3, updated_at = ?4
                WHERE actor_id = ?5 AND authority_epoch_id = ?6
                  AND accepted_counter = ?7
                  AND accepted_operation_id IS ?8
                  AND accepted_chain_digest = ?9;`,
          bind: [
            last.actor_sequence,
            last.operation_id,
            last.actor_chain_digest,
            resultEnvelope.resolved_at_ms,
            verified.accepted_actor_state.actor_id,
            verified.accepted_actor_state.epoch_id,
            verified.accepted_actor_state.next_actor_sequence - 1,
            verified.accepted_actor_state.previous_actor_operation_id,
            verified.accepted_actor_state.previous_actor_chain_digest,
          ],
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "normalized operation actor update",
          ) !== 1
        ) {
          throw new Error("normalized operation actor tip changed");
        }
        this.#database.exec({
          sql: `UPDATE library_change_state SET revision = ?1
                WHERE singleton_id = 1 AND revision = ?2;`,
          bind: [nextRevision, previousRevision],
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "normalized operation change revision update",
          ) !== 1
        ) {
          throw new Error("normalized operation change revision changed");
        }
        this.#database.exec({
          sql: `UPDATE library_meta
                SET source_revision = ?1, updated_at = ?2
                WHERE singleton_id = 1 AND source_revision = ?3;`,
          bind: [nextRevision, resultEnvelope.resolved_at_ms, previousRevision],
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "normalized operation source revision update",
          ) !== 1
        ) {
          throw new Error("normalized operation source revision changed");
        }
        this.#database.exec({
          sql: `INSERT INTO library_operation_replication_results
                  (source_revision, transaction_id, result_digest,
                   canonical_result, received_at)
                VALUES (?1, ?2, ?3, ?4, ?5);`,
          bind: [
            nextRevision,
            resultEnvelope.transaction_id,
            verifiedResult.resultDigest,
            verifiedResult.canonicalBytes,
            safeInteger(stage[8], "operation stage received time"),
          ],
        });
        this.#database.exec({
          sql: `DELETE FROM library_optimistic_fields
                WHERE transaction_id = ?1
                  AND EXISTS (
                    SELECT 1 FROM library_intent_results
                    WHERE transaction_id = ?1
                      AND status = 'accepted'
                      AND result_digest = ?2
                      AND canonical_result = ?3
                  );`,
          bind: [
            resultEnvelope.transaction_id,
            verifiedResult.resultDigest,
            verifiedResult.canonicalBytes,
          ],
        });
        this.#database.exec({
          sql: `DELETE FROM library_operation_replication_stages
                WHERE source_revision = ?1;`,
          bind: [nextRevision],
        });
        this.#database.exec("COMMIT;");
        appliedTransactionCount += 1;
      } catch (error) {
        this.#database.exec("ROLLBACK;");
        throw error;
      }
    }

    const appliedThroughRevision = safeInteger(
      this.#database.exec({
        sql: "SELECT source_revision FROM library_meta WHERE singleton_id = 1;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "normalized operation applied revision",
    );
    return Object.freeze({
      appliedThroughRevision,
      appliedTransactionCount,
      receivedAt: imported.receivedAt,
      stagedRecordCount: imported.page.records.length,
      stagedTransactionCount: touchedRevisions.size,
    });
  }

  async #applyAcceptedFollowerResultThroughOperationImport(
    verified: LibraryCoreVerifiedFollowerResultV1,
    receivedAt: number,
  ): Promise<void> {
    const envelope = verified.envelope;
    if (envelope.status !== "accepted") return;
    const transactionRows = this.#database.exec({
      sql: `SELECT transaction_digest, member_count
            FROM library_intent_transactions
            WHERE transaction_id = ?1 AND actor_id = ?2;`,
      bind: [envelope.transaction_id, envelope.actor_id],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (
      transactionRows.length !== 1 ||
      text(transactionRows[0]![0], "accepted result transaction digest") !==
        envelope.transaction_digest ||
      safeInteger(transactionRows[0]![1], "accepted result member count") !==
        envelope.canonical_operation_ids.length
    ) {
      throw new Error("accepted result operation transaction is unavailable");
    }
    const memberRows = this.#database.exec({
      sql: `SELECT member_index, operation_id, canonical_member
            FROM library_intent_members
            WHERE transaction_id = ?1 ORDER BY member_index;`,
      bind: [envelope.transaction_id],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (
      memberRows.length !== envelope.canonical_operation_ids.length ||
      memberRows.some(
        (row, index) =>
          safeInteger(row[0], "accepted result member index") !== index ||
          text(row[1], "accepted result operation ID") !==
            envelope.canonical_operation_ids[index],
      )
    ) {
      throw new Error("accepted result operation membership changed");
    }
    const authorityRows = this.#database.exec({
      sql: `SELECT m.library_id, m.authority_epoch, m.source_revision,
                   active.writer_id
            FROM library_meta AS m
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id
             AND active.epoch_id = m.authority_epoch
             AND active.active_key = 'active'
            WHERE m.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (
      authorityRows.length !== 1 ||
      text(authorityRows[0]![0], "accepted result Library") !==
        envelope.library_id ||
      text(authorityRows[0]![1], "accepted result epoch") !== envelope.epoch_id
    ) {
      throw new Error("accepted result operation authority changed");
    }
    const sourceRevision = Math.max(
      safeInteger(authorityRows[0]![2], "accepted result source revision"),
      envelope.authoritative_source_revision,
    );
    const snapshot = Object.freeze({
      authorityEpoch: envelope.epoch_id,
      firstAvailableRevision: envelope.authoritative_source_revision,
      format: LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_FORMAT,
      libraryId: envelope.library_id,
      operationCount: memberRows.length,
      protocolVersion:
        LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION,
      sourceRevision,
      transactionCount: 1,
      writerId: text(authorityRows[0]![3], "accepted result writer"),
    });
    const records = [
      Object.freeze({
        canonicalRecordJson: strictUtf8Decoder.decode(verified.canonicalBytes),
        kind: "accepted_transaction",
        memberIndex: -1,
        recordDigest: verified.resultDigest,
        sourceRevision: envelope.authoritative_source_revision,
        transactionDigest: envelope.transaction_digest,
        transactionId: envelope.transaction_id,
      }),
      ...memberRows.map((row, index) =>
        Object.freeze({
          canonicalRecordJson: strictUtf8Decoder.decode(
            bytes(row[2], "accepted result canonical operation"),
          ),
          kind: "operation" as const,
          memberIndex: index,
          recordDigest: envelope.receipt_ids[index]!,
          sourceRevision: envelope.authoritative_source_revision,
          transactionDigest: envelope.transaction_digest,
          transactionId: envelope.transaction_id,
        }),
      ),
    ];
    let index = 0;
    while (index < records.length) {
      const pageRecords: (typeof records)[number][] = [];
      let canonicalRecordBytes = 0;
      while (
        index < records.length &&
        pageRecords.length <
          LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS
      ) {
        const next = records[index]!;
        const nextBytes = textEncoder.encode(
          next.canonicalRecordJson,
        ).byteLength;
        if (
          pageRecords.length > 0 &&
          canonicalRecordBytes + nextBytes >
            LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES
        ) {
          break;
        }
        if (
          nextBytes >
          LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES
        ) {
          throw new Error("accepted result operation record exceeds its page");
        }
        pageRecords.push(next);
        canonicalRecordBytes += nextBytes;
        index += 1;
      }
      const last = pageRecords.at(-1);
      if (!last) {
        throw new Error("accepted result operation page is empty");
      }
      await this.importNormalizedOperationPage(
        parseLibraryCoreNormalizedOperationImportPageV2({
          page: {
            canonicalRecordBytes,
            done: index === records.length,
            nextCursor: {
              kind: last.kind,
              memberIndex: last.memberIndex,
              recordDigest: last.recordDigest,
              sourceRevision: last.sourceRevision,
            },
            records: pageRecords,
          },
          receivedAt,
          snapshot,
        }),
      );
    }
  }

  async importNormalizedFollowerResultTransport(
    input: LibraryCoreNormalizedResultTransportImportV2,
  ): Promise<LibraryCoreNormalizedResultTransportImportReceiptV2> {
    const publication =
      parseLibraryCoreNormalizedResultTransportImportV2(input);
    const body = normalizedResultSegmentBodyFromRecordsV2(
      publication.header,
      publication.results,
    );
    const semanticSegmentDigest = sha256LowerHex(
      encodeLibraryCoreDigestInput(
        "normalized-result-segment-body-v2",
        body as unknown as LibraryCoreCanonicalValue,
      ),
    );
    if (semanticSegmentDigest !== publication.header.segment_digest) {
      throw new Error("normalized result transport semantic digest changed");
    }

    const authorityRows = this.#database.exec({
      sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                   e.authority_key_id, e.authority_public_key
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            WHERE m.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (authorityRows.length !== 1) {
      throw new Error("normalized result transport authority is unavailable");
    }
    const authorityRow = authorityRows[0]!;
    const authority = Object.freeze({
      authorityKeyId: text(
        authorityRow[3],
        "normalized result authority key ID",
      ),
      authorityPublicKey: text(
        authorityRow[4],
        "normalized result authority public key",
      ),
      epoch: safeInteger(authorityRow[1], "normalized result authority epoch"),
      epochId: text(authorityRow[2], "normalized result authority epoch ID"),
      libraryId: text(
        authorityRow[0],
        "normalized result authority Library ID",
      ),
    });
    if (
      authority.libraryId !== publication.header.library_id ||
      authority.epochId !== publication.header.storage_epoch_id
    ) {
      throw new Error("normalized result transport authority changed");
    }
    const verifiedResults = await Promise.all(
      publication.results.map((result) => {
        const canonicalBytes = encodeLibraryCoreCanonicalValue(
          result as unknown as LibraryCoreCanonicalValue,
          { maximumBytes: 131_072 },
        );
        return verifyLibraryCoreFollowerResultV1(canonicalBytes, authority, {
          verifySignature: (verification) =>
            verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
        });
      }),
    );
    const storedSegmentDigest = publication.reference.descriptor.contentDigest;
    const firstResultSequence = publication.header.first_result_sequence;
    const lastResultSequence = publication.header.last_result_sequence;

    let receipt: LibraryCoreNormalizedResultTransportImportReceiptV2;
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_result_transport_heads
                (actor_id, library_id, storage_epoch_id, next_result_sequence,
                 latest_segment_digest)
              VALUES (?1, ?2, ?3, 1, NULL);`,
        bind: [
          publication.header.actor_id,
          publication.header.library_id,
          publication.header.storage_epoch_id,
        ],
      });
      const headRows = this.#database.exec({
        sql: `SELECT library_id, storage_epoch_id, next_result_sequence,
                     latest_segment_digest
              FROM library_result_transport_heads WHERE actor_id = ?1;`,
        bind: [publication.header.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        headRows.length !== 1 ||
        text(headRows[0]![0], "normalized result head Library ID") !==
          publication.header.library_id ||
        text(headRows[0]![1], "normalized result head storage epoch") !==
          publication.header.storage_epoch_id
      ) {
        throw new Error("normalized result transport head identity changed");
      }
      const existingRows = this.#database.exec({
        sql: `SELECT last_result_sequence, previous_segment_digest,
                     semantic_segment_digest, stored_segment_digest, object_key,
                     transport_object_id, received_at, result_count,
                     accepted_transaction_count, rejected_transaction_count
              FROM library_result_transport_segments
              WHERE actor_id = ?1 AND first_result_sequence = ?2;`,
        bind: [publication.header.actor_id, firstResultSequence],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (existingRows.length === 1) {
        const row = existingRows[0]!;
        if (
          safeInteger(row[0], "stored result last sequence") !==
            lastResultSequence ||
          nullableText(row[1], "stored result previous digest") !==
            publication.header.previous_segment_digest ||
          text(row[2], "stored result semantic digest") !==
            semanticSegmentDigest ||
          text(row[3], "stored result content digest") !==
            storedSegmentDigest ||
          text(row[4], "stored result object key") !==
            publication.reference.descriptor.objectKey ||
          text(row[5], "stored result transport object ID") !==
            publication.reference.transportObjectId ||
          safeInteger(row[6], "stored result received time") !==
            publication.receivedAt ||
          safeInteger(row[7], "stored result count") !==
            publication.results.length
        ) {
          throw new Error("normalized result transport replay changed");
        }
        this.#database.exec("COMMIT;");
        receipt = Object.freeze({
          acceptedTransactionCount: safeInteger(
            row[8],
            "stored accepted result count",
          ),
          actorId: publication.header.actor_id,
          firstResultSequence,
          lastResultSequence,
          nextResultSequence: lastResultSequence + 1,
          receivedAt: publication.receivedAt,
          rejectedTransactionCount: safeInteger(
            row[9],
            "stored rejected result count",
          ),
          resultCount: publication.results.length,
          semanticSegmentDigest,
          storedSegmentDigest,
        });
      } else if (
        safeInteger(headRows[0]![2], "normalized result next sequence") !==
          firstResultSequence ||
        nullableText(headRows[0]![3], "normalized result latest digest") !==
          publication.header.previous_segment_digest
      ) {
        throw new Error("normalized result transport does not extend its head");
      } else {
        for (const verified of verifiedResults) {
          this.#applyVerifiedFollowerResult(
            verified,
            authority,
            publication.receivedAt,
            false,
          );
        }
        const rejectedTransactionCount = publication.results.filter(
          (result) => result.status === "rejected",
        ).length;
        const acceptedTransactionCount =
          publication.results.length - rejectedTransactionCount;
        this.#database.exec({
          sql: `INSERT INTO library_result_transport_segments
                (actor_id, first_result_sequence, last_result_sequence,
                 previous_segment_digest, semantic_segment_digest,
                 stored_segment_digest, object_key, transport_object_id,
                 received_at, result_count, accepted_transaction_count,
                 rejected_transaction_count)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12);`,
          bind: [
            publication.header.actor_id,
            firstResultSequence,
            lastResultSequence,
            publication.header.previous_segment_digest,
            semanticSegmentDigest,
            storedSegmentDigest,
            publication.reference.descriptor.objectKey,
            publication.reference.transportObjectId,
            publication.receivedAt,
            publication.results.length,
            acceptedTransactionCount,
            rejectedTransactionCount,
          ],
        });
        this.#database.exec({
          sql: `UPDATE library_result_transport_heads
              SET next_result_sequence = ?2, latest_segment_digest = ?3
              WHERE actor_id = ?1 AND next_result_sequence = ?4
                AND latest_segment_digest IS ?5;`,
          bind: [
            publication.header.actor_id,
            lastResultSequence + 1,
            storedSegmentDigest,
            firstResultSequence,
            publication.header.previous_segment_digest,
          ],
        });
        if (
          safeInteger(
            this.#database.exec({
              sql: "SELECT changes();",
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "normalized result head update",
          ) !== 1
        ) {
          throw new Error(
            "normalized result transport head changed concurrently",
          );
        }
        this.#database.exec("COMMIT;");
        receipt = Object.freeze({
          acceptedTransactionCount,
          actorId: publication.header.actor_id,
          firstResultSequence,
          lastResultSequence,
          nextResultSequence: lastResultSequence + 1,
          receivedAt: publication.receivedAt,
          rejectedTransactionCount,
          resultCount: publication.results.length,
          semanticSegmentDigest,
          storedSegmentDigest,
        });
      }
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
    for (const verified of verifiedResults) {
      await this.#applyAcceptedFollowerResultThroughOperationImport(
        verified,
        publication.receivedAt,
      );
    }
    return receipt;
  }

  async applyFollowerResult(
    input: LibraryCoreFollowerResultApplyV1,
  ): Promise<LibraryCoreFollowerResultApplyReceiptV1> {
    const apply = parseLibraryCoreFollowerResultApplyV1(input);
    const candidate = parseLibraryCoreFollowerResultEnvelopeV1(
      decodeLibraryCoreCanonicalValue(apply.canonicalResultBytes, {
        maximumBytes: 131_072,
      }),
    );
    const authorityRows = this.#database.exec({
      sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                   e.authority_key_id, e.authority_public_key
            FROM library_meta AS m
            JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
            JOIN library_active_authority AS active
              ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
            WHERE m.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (authorityRows.length !== 1) {
      throw new Error("follower result active authority is unavailable");
    }
    const authorityRow = authorityRows[0]!;
    const authority = Object.freeze({
      authorityKeyId: text(authorityRow[3], "follower result authority key ID"),
      authorityPublicKey: text(
        authorityRow[4],
        "follower result authority public key",
      ),
      epoch: safeInteger(authorityRow[1], "follower result epoch"),
      epochId: text(authorityRow[2], "follower result epoch ID"),
      libraryId: text(authorityRow[0], "follower result Library ID"),
    });
    const verified = await verifyLibraryCoreFollowerResultV1(
      apply.canonicalResultBytes,
      authority,
      {
        verifySignature: (verification) =>
          verifyLibraryCoreEd25519WithWebCrypto(verification, this.#subtle),
      },
    );
    const receivedAt = this.#now();
    if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
      throw new Error("follower result clock is invalid");
    }

    this.#applyVerifiedFollowerResult(verified, authority, receivedAt, true);
    await this.#applyAcceptedFollowerResultThroughOperationImport(
      verified,
      receivedAt,
    );
    const receipt = this.#followerResultRetry(
      candidate.transaction_id,
      apply.canonicalResultBytes,
    );
    if (receipt === null) {
      throw new Error("follower result receipt disappeared after apply");
    }
    return receipt;
  }

  #applyVerifiedFollowerResult(
    verified: LibraryCoreVerifiedFollowerResultV1,
    authority: LibraryCoreFollowerResultVerificationAuthorityV1,
    receivedAt: number,
    manageTransaction: boolean,
  ): LibraryCoreFollowerResultApplyReceiptV1 {
    if (manageTransaction) this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const retryInsideTransaction = this.#followerResultRetry(
        verified.envelope.transaction_id,
        verified.canonicalBytes,
      );
      if (retryInsideTransaction !== null) {
        if (manageTransaction) this.#database.exec("COMMIT;");
        return retryInsideTransaction;
      }
      const currentAuthority = this.#database.exec({
        sql: `SELECT m.library_id, e.epoch_number, e.epoch_id,
                     e.authority_key_id, e.authority_public_key,
                     m.source_revision, changes.revision
              FROM library_meta AS m
              JOIN library_authority_epochs AS e ON e.epoch_id = m.authority_epoch
              JOIN library_active_authority AS active
                ON active.library_id = m.library_id AND active.epoch_id = e.epoch_id
              JOIN library_change_state AS changes ON changes.singleton_id = m.singleton_id
              WHERE m.singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (currentAuthority.length !== 1) {
        throw new Error(
          "follower result authority changed during verification",
        );
      }
      const current = currentAuthority[0]!;
      if (
        text(current[0], "current result Library ID") !== authority.libraryId ||
        safeInteger(current[1], "current result epoch") !== authority.epoch ||
        text(current[2], "current result epoch ID") !== authority.epochId ||
        text(current[3], "current result key ID") !==
          authority.authorityKeyId ||
        text(current[4], "current result public key") !==
          authority.authorityPublicKey
      ) {
        throw new Error(
          "follower result authority changed during verification",
        );
      }
      const sourceRevision = safeInteger(
        current[5],
        "current result source revision",
      );
      if (
        sourceRevision !==
        safeInteger(current[6], "current result change revision")
      ) {
        throw new Error("follower result source revisions disagree");
      }
      const envelope = verified.envelope;
      const transactions = this.#database.exec({
        sql: `SELECT transaction_digest, actor_id, member_count, state, created_at,
                     intent_epoch, intent_epoch_id
              FROM library_intent_transactions WHERE transaction_id = ?1;`,
        bind: [envelope.transaction_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (transactions.length !== 1) {
        throw new Error("follower result intent transaction is unavailable");
      }
      const transaction = transactions[0]!;
      const memberCount = safeInteger(
        transaction[2],
        "follower result intent member count",
      );
      if (
        text(transaction[0], "follower result transaction digest") !==
          envelope.transaction_digest ||
        text(transaction[1], "follower result actor ID") !==
          envelope.actor_id ||
        safeInteger(transaction[5], "follower result intent epoch") !==
          envelope.intent_epoch ||
        text(transaction[6], "follower result intent epoch ID") !==
          envelope.intent_epoch_id ||
        !["pending", "published"].includes(
          text(transaction[3], "follower result intent state"),
        ) ||
        envelope.resolved_at_ms <
          safeInteger(transaction[4], "follower result intent creation time")
      ) {
        throw new Error("follower result does not match its pending intent");
      }
      if (
        envelope.status === "accepted" &&
        (envelope.canonical_operation_ids.length !== memberCount ||
          envelope.receipt_ids.length !== memberCount)
      ) {
        throw new Error("accepted follower result is incomplete");
      }

      this.#database.exec({
        sql: `INSERT OR IGNORE INTO library_intent_result_cursors
                (actor_id, next_result_sequence, previous_result_digest)
              VALUES (?1, 1, NULL);`,
        bind: [envelope.actor_id],
      });
      const cursorRows = this.#database.exec({
        sql: `SELECT next_result_sequence, previous_result_digest
              FROM library_intent_result_cursors WHERE actor_id = ?1;`,
        bind: [envelope.actor_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        cursorRows.length !== 1 ||
        safeInteger(cursorRows[0]![0], "follower result next sequence") !==
          envelope.result_sequence ||
        nullableText(
          cursorRows[0]![1],
          "follower result previous cursor digest",
        ) !== envelope.previous_result_digest
      ) {
        throw new Error("follower result cursor is not contiguous");
      }

      const optimisticRows = this.#database.exec({
        sql: `SELECT entity_type, entity_id, field_path
              FROM library_optimistic_fields
              WHERE transaction_id = ?1
              ORDER BY entity_type COLLATE BINARY,
                       entity_id COLLATE BINARY, field_path COLLATE BINARY;`,
        bind: [envelope.transaction_id],
        rowMode: "array",
        returnValue: "resultRows",
      });
      const replacements = [...envelope.replacement_fields].sort(
        (left, right) => {
          const leftKey = `${left.entity_type}\u0000${left.entity_id}\u0000${left.field_path}`;
          const rightKey = `${right.entity_type}\u0000${right.entity_id}\u0000${right.field_path}`;
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        },
      );
      if (
        optimisticRows.length !== replacements.length ||
        optimisticRows.some((row, index) => {
          const replacement = replacements[index]!;
          return (
            text(row[0], "optimistic entity type") !==
              replacement.entity_type ||
            text(row[1], "optimistic entity ID") !== replacement.entity_id ||
            text(row[2], "optimistic field path") !== replacement.field_path
          );
        })
      ) {
        throw new Error("follower result replacement projection is incomplete");
      }

      if (
        envelope.status === "accepted" &&
        envelope.authoritative_source_revision <= sourceRevision
      ) {
        const applied = this.#database.exec({
          sql: `SELECT result.result_digest, result.canonical_result
                FROM library_operation_replication_results AS result
                JOIN library_transactions AS tx
                  ON tx.transaction_id = result.transaction_id
                 AND tx.committed_revision = result.source_revision
                WHERE result.source_revision = ?1
                  AND result.transaction_id = ?2;`,
          bind: [
            envelope.authoritative_source_revision,
            envelope.transaction_id,
          ],
          rowMode: "array",
          returnValue: "resultRows",
        });
        if (
          applied.length !== 1 ||
          text(applied[0]![0], "applied follower result digest") !==
            verified.resultDigest ||
          !sameBytes(
            bytes(applied[0]![1], "applied follower canonical result"),
            verified.canonicalBytes,
          )
        ) {
          throw new Error(
            "accepted follower result revision lacks its operation",
          );
        }
      }

      if (
        envelope.status !== "accepted" ||
        envelope.authoritative_source_revision <= sourceRevision
      ) {
        this.#database.exec({
          sql: `DELETE FROM library_optimistic_fields
                WHERE transaction_id = ?1;`,
          bind: [envelope.transaction_id],
        });
      }
      this.#database.exec({
        sql: `INSERT INTO library_intent_results
                (transaction_id, actor_id, authority_epoch_id, intent_epoch_id,
                 result_sequence,
                 previous_result_digest, result_digest, status,
                 authoritative_source_revision, canonical_result, received_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);`,
        bind: [
          envelope.transaction_id,
          envelope.actor_id,
          envelope.epoch_id,
          envelope.intent_epoch_id,
          envelope.result_sequence,
          envelope.previous_result_digest,
          verified.resultDigest,
          envelope.status,
          envelope.authoritative_source_revision,
          verified.canonicalBytes,
          receivedAt,
        ],
      });
      this.#database.exec({
        sql: `UPDATE library_intent_transactions
              SET state = ?2, resolved_at = ?3
              WHERE transaction_id = ?1 AND state IN ('pending', 'published');`,
        bind: [
          envelope.transaction_id,
          envelope.status === "rejected" ? "rejected" : "accepted",
          envelope.resolved_at_ms,
        ],
      });
      this.#database.exec({
        sql: `UPDATE library_intent_result_cursors
              SET next_result_sequence = ?2, previous_result_digest = ?3
              WHERE actor_id = ?1 AND next_result_sequence = ?4
                AND previous_result_digest IS ?5;`,
        bind: [
          envelope.actor_id,
          envelope.result_sequence + 1,
          verified.resultDigest,
          envelope.result_sequence,
          envelope.previous_result_digest,
        ],
      });
      if (
        safeInteger(
          this.#database.exec({
            sql: "SELECT changes();",
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "follower result cursor update",
        ) !== 1
      ) {
        throw new Error("follower result cursor compare-and-swap failed");
      }
      if (manageTransaction) this.#database.exec("COMMIT;");
      return Object.freeze({
        actorId: envelope.actor_id,
        resultDigest: verified.resultDigest,
        resultSequence: envelope.result_sequence,
        sourceRevision,
        status: envelope.status,
        transactionId: envelope.transaction_id,
      });
    } catch (error) {
      if (manageTransaction) this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #followerResultRetry(
    transactionId: string,
    canonicalBytes: Uint8Array,
  ): LibraryCoreFollowerResultApplyReceiptV1 | null {
    const rows = this.#database.exec({
      sql: `SELECT actor_id, result_sequence, result_digest, status,
                   authoritative_source_revision, canonical_result
            FROM library_intent_results WHERE transaction_id = ?1;`,
      bind: [transactionId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length === 0) return null;
    const row = rows[0]!;
    const stored = row[5];
    if (
      !(stored instanceof Uint8Array) ||
      stored.byteLength !== canonicalBytes.byteLength ||
      !stored.every((byte, index) => byte === canonicalBytes[index])
    ) {
      throw new Error("follower result identity was reused with changed bytes");
    }
    const sourceRevision = safeInteger(
      this.#database.exec({
        sql: "SELECT source_revision FROM library_meta WHERE singleton_id = 1;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "follower result retry source revision",
    );
    return Object.freeze({
      actorId: text(row[0], "stored follower result actor"),
      resultDigest: text(row[2], "stored follower result digest"),
      resultSequence: safeInteger(row[1], "stored follower result sequence"),
      sourceRevision,
      status: text(row[3], "stored follower result status") as
        "accepted" | "already_applied" | "rejected",
      transactionId,
    });
  }

  #followerIntentRetry(
    transactionId: string,
    envelopeBytes: readonly Uint8Array[],
  ): LibraryCoreFollowerIntentCommitResultV1 | null {
    const transactions = this.#database.exec({
      sql: `SELECT actor_id, member_count, first_counter, last_counter, state
            FROM library_intent_transactions WHERE transaction_id = ?1;`,
      bind: [transactionId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (transactions.length === 0) return null;
    const transaction = transactions[0]!;
    const memberCount = safeInteger(
      transaction[1],
      "stored intent member count",
    );
    const members = this.#database.exec({
      sql: `SELECT canonical_member FROM library_intent_members
            WHERE transaction_id = ?1 ORDER BY member_index;`,
      bind: [transactionId],
      rowMode: 0,
      returnValue: "resultRows",
    });
    const exact =
      memberCount === envelopeBytes.length &&
      members.length === envelopeBytes.length &&
      members.every((value, index) => {
        const stored = value instanceof Uint8Array ? value : null;
        const received = envelopeBytes[index]!;
        return (
          stored !== null &&
          stored.byteLength === received.byteLength &&
          stored.every((byte, byteIndex) => byte === received[byteIndex])
        );
      });
    if (!exact) {
      throw new Error("follower intent identity was reused with changed bytes");
    }
    const optimisticFieldCount = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*) FROM library_optimistic_fields
              WHERE transaction_id = ?1;`,
        bind: [transactionId],
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "stored optimistic field count",
    );
    const state = text(transaction[4], "stored intent state");
    if (state !== "pending" && state !== "published") {
      throw new Error("resolved follower intent cannot be recommitted");
    }
    return Object.freeze({
      actorId: text(transaction[0], "stored intent actor"),
      firstCounter: safeInteger(transaction[2], "stored intent first counter"),
      lastCounter: safeInteger(transaction[3], "stored intent last counter"),
      memberCount,
      optimisticFieldCount,
      state,
      transactionId,
    });
  }

  beginScopeAction(
    stageId: string,
    input: LibraryCoreAnyScopeActionRequestV1,
    createdAt: number,
  ): LibraryCoreScopeActionStageStatusV1 {
    const request = parseLibraryCoreAnyScopeActionRequestV1(input);
    if (
      stageId.length < 1 ||
      stageId.length > 255 ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0
    ) {
      throw new Error("Library scope action stage identity is invalid");
    }
    const digest = digestLibraryCoreAnyScopeActionRequestV1(request);
    const frozenRssScope = request.action.startsWith("rss_feeds_");
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database.exec({
        sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.create,
        bind: [stageId, request.action, digest, createdAt],
      });
      if (!frozenRssScope) {
        this.#database.exec("COMMIT;");
        return Object.freeze({ memberCount: 0, stageId, state: "staging" });
      }
      this.#database.exec({
        sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.freezeRssFeeds,
        bind: [stageId, request.action],
      });
      const memberCount = safeInteger(
        this.#database.exec({
          sql: `SELECT count(*) FROM library_device_scope_action_members
                WHERE action_id = ?1;`,
          bind: [stageId],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "frozen RSS scope member count",
      );
      this.#database.exec({
        sql: "UPDATE library_device_scope_actions SET member_count = ?2 WHERE action_id = ?1;",
        bind: [stageId, memberCount],
      });
      this.#database.exec({
        sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.finalize,
        bind: [stageId, memberCount],
      });
      this.#database.exec("COMMIT;");
      return Object.freeze({ memberCount, stageId, state: "ready" });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  appendScopeAction(
    stageId: string,
    expectedOrdinal: number,
    entityIds: readonly string[],
  ): LibraryCoreScopeActionStageStatusV1 {
    if (
      !Number.isSafeInteger(expectedOrdinal) ||
      expectedOrdinal < 0 ||
      entityIds.length < 1 ||
      entityIds.length > 256 ||
      entityIds.some((id) => !id || new TextEncoder().encode(id).length > 4_096)
    ) {
      throw new Error("Library scope action append is invalid");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const status = this.#database.exec({
        sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.status,
        bind: [stageId],
        rowMode: "array",
        returnValue: "resultRows",
      });
      if (
        status.length !== 1 ||
        text(status[0]?.[2], "scope action state") !== "staging" ||
        safeInteger(status[0]?.[3], "scope action member count") !==
          expectedOrdinal
      ) {
        throw new Error("Library scope action append fence is stale");
      }
      this.#database.exec({
        sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.append,
        bind: [stageId, expectedOrdinal, JSON.stringify(entityIds)],
      });
      const memberCount = expectedOrdinal + entityIds.length;
      this.#database.exec({
        sql: "UPDATE library_device_scope_actions SET member_count = ?2 WHERE action_id = ?1;",
        bind: [stageId, memberCount],
      });
      this.#database.exec("COMMIT;");
      return Object.freeze({ memberCount, stageId, state: "staging" });
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  finalizeScopeAction(
    stageId: string,
    expectedMemberCount: number,
  ): LibraryCoreScopeActionStageStatusV1 {
    if (!Number.isSafeInteger(expectedMemberCount) || expectedMemberCount < 0) {
      throw new Error("Library scope action final count is invalid");
    }
    this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.finalize,
      bind: [stageId, expectedMemberCount],
    });
    const status = this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.status,
      bind: [stageId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (
      status.length !== 1 ||
      text(status[0]?.[2], "scope action state") !== "ready" ||
      safeInteger(status[0]?.[3], "scope action member count") !==
        expectedMemberCount
    ) {
      throw new Error("Library scope action could not finalize");
    }
    return Object.freeze({
      memberCount: expectedMemberCount,
      stageId,
      state: "ready",
    });
  }

  pageScopeAction(
    stageId: string,
    afterOrdinal: number,
  ): LibraryCoreScopeActionStagePageV1 {
    if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < -1) {
      throw new Error("Library scope action page cursor is invalid");
    }
    const rows = this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.page,
      bind: [stageId, afterOrdinal, 1_000],
      rowMode: "array",
      returnValue: "resultRows",
    });
    const entityIds = rows.map((row) => text(row[1], "scope action entity ID"));
    return Object.freeze({
      entityIds: Object.freeze(entityIds),
      nextOrdinal:
        rows.length === 0
          ? afterOrdinal
          : safeInteger(rows.at(-1)?.[0], "scope action ordinal"),
      stageId,
    });
  }

  closeScopeAction(stageId: string): void {
    this.#database.exec({
      sql: LIBRARY_CORE_SQLITE_SCOPE_ACTION_PROGRAMS.delete,
      bind: [stageId],
    });
  }

  query<T extends LibraryCoreSqliteQueryRequest>(
    input: T,
  ): LibraryCoreSqliteQueryResponseFor<T> {
    switch (input.queryId) {
      case "account_detail_v1":
        return this.#queryAccountDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "account_graph_page_v1":
        return this.#queryAccountGraphPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "account_timeline_v1":
        return this.#queryAccountTimeline(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "change_feed_v1":
        return this.#queryChangeFeed(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "local_change_feed_v1":
        return this.#queryLocalChangeFeed(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "optimistic_fields_v1":
        return this.#queryOptimisticFields(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "contact_match_v1":
        return this.#queryContactMatch(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "library_facet_summary_v1":
        return this.#queryFacetSummary(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "feed_page_v1":
        return this.#queryFeedPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "feed_browse_page_v3":
        return this.#queryFeedBrowsePage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "filter_scope_summary_v1":
        return this.#queryFilterScopeSummary(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "friend_candidate_review_v1":
        return this.#queryFriendCandidateReview(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "friends_directory_page_v1":
        return this.#queryFriendsDirectory(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "item_detail_v1":
        return this.#queryItemDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "item_reader_body_v1":
        return this.#queryItemReaderBody(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "background_item_page_v1":
        return this.#queryItemScan(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "content_fetch_claim_v1":
        return this.#queryContentFetchPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "provider_media_page_v1":
        return this.#queryProviderMediaPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "map_markers_v1":
        return this.#queryMapMarkers(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "person_detail_v1":
        return this.#queryPersonDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "person_graph_page_v1":
        return this.#queryPersonGraphPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "account_link_candidates_v1":
        return this.#queryAccountLinkCandidates(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "account_picker_page_v1":
        return this.#queryAccountPickerPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "person_picker_page_v1":
        return this.#queryPersonPickerPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "person_timeline_v1":
        return this.#queryPersonTimeline(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "persons_graph_v1":
        return this.#queryPersonsGraph(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "rss_feed_detail_v1":
        return this.#queryRssFeedDetail(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "rss_feed_page_v1":
        return this.#queryRssFeedPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "saved_analytics_v2":
        return this.#querySavedAnalytics(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "saved_feed_page_v2":
        return this.#querySavedFeedPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "search_page_v1":
        return this.#querySearchPage(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "story_wall_candidates_v1":
        return this.#queryStoryWallCandidates(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
      case "preferences_snapshot_v1":
        return this.#queryPreferencesSnapshot(
          input,
        ) as LibraryCoreSqliteQueryResponseFor<T>;
    }
  }

  #querySource(): {
    readonly generationId: string;
    readonly sourceRevision: number;
  } {
    const rows = this.#database.exec({
      sql: `SELECT generation.generation_id, meta.source_revision, changes.revision
            FROM library_materialization_generation AS generation
            JOIN library_meta AS meta ON meta.singleton_id = generation.singleton_id
            JOIN library_change_state AS changes ON changes.singleton_id = generation.singleton_id
            WHERE generation.singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA Library SQLite has no active materialization");
    }
    const generationId = text(rows[0]![0], "Library generation identity");
    const sourceRevision = safeInteger(rows[0]![1], "Library source revision");
    if (
      sourceRevision !== safeInteger(rows[0]![2], "Library change revision")
    ) {
      throw new Error("PWA Library SQLite change revisions disagree");
    }
    return Object.freeze({ generationId, sourceRevision });
  }

  #queryGraphSource(): {
    readonly generationId: string;
    readonly layoutRevision: number;
    readonly sourceRevision: number;
  } {
    const source = this.#querySource();
    const rows = this.#database.exec({
      sql: "SELECT revision FROM library_device_graph_layout_state WHERE singleton_id = 1;",
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA Library SQLite has no device graph layout state");
    }
    return Object.freeze({
      ...source,
      layoutRevision: safeInteger(rows[0], "device graph layout revision"),
    });
  }

  #queryChangeFeed(
    input: LibraryCoreChangeFeedRequestV1,
  ): LibraryCoreChangeFeedResponseV1 {
    return this.#queryChangeFeedProgram(
      input,
      false,
    ) as LibraryCoreChangeFeedResponseV1;
  }

  #queryLocalChangeFeed(
    input: LibraryCoreLocalChangeFeedRequestV1,
  ): LibraryCoreLocalChangeFeedResponseV1 {
    return this.#queryChangeFeedProgram(
      input,
      true,
    ) as LibraryCoreLocalChangeFeedResponseV1;
  }

  #queryOptimisticFields(
    input: LibraryCoreOptimisticFieldsRequestV1,
  ): LibraryCoreOptimisticFieldsResponseV1 {
    const request = parseLibraryCoreOptimisticFieldsRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.optimistic_fields_v1;
    const localSequence = safeInteger(
      this.#database.exec({
        sql: program.countSql,
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "optimistic-fields local sequence",
    );
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [JSON.stringify(request.value.entityIds)],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length >= program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite optimistic fields exceeded their row bound",
      );
    }
    const rows = rawRows.map((row) => {
      const generated = coerceLibraryCoreGeneratedSqliteQueryRow(
        "optimistic_fields_v1",
        row,
      );
      if (!generated) {
        throw new Error("PWA Library SQLite optimistic field row is invalid");
      }
      const value =
        generated.valueType === "boolean"
          ? generated.booleanValue
          : generated.valueType === "integer"
            ? generated.integerValue
            : null;
      if (
        (generated.valueType === "boolean" &&
          (value === null || generated.integerValue !== null)) ||
        (generated.valueType === "integer" &&
          (value === null || generated.booleanValue !== null)) ||
        (generated.valueType === "null" &&
          (generated.booleanValue !== null || generated.integerValue !== null))
      ) {
        throw new Error("PWA Library SQLite optimistic field value is invalid");
      }
      return Object.freeze({
        entityId: generated.entityId,
        fieldPath: generated.fieldPath,
        value,
        valueType: generated.valueType,
      });
    });
    const response = {
      queryId: "optimistic_fields_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: localSequence,
      },
    };
    const parsed = parseLibraryCoreOptimisticFieldsResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryChangeFeedProgram(
    input: LibraryCoreChangeFeedRequestV1 | LibraryCoreLocalChangeFeedRequestV1,
    local: boolean,
  ): LibraryCoreChangeFeedResponseV1 | LibraryCoreLocalChangeFeedResponseV1 {
    const request = local
      ? parseLibraryCoreLocalChangeFeedRequestV1(input)
      : parseLibraryCoreChangeFeedRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = local
      ? LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.local_change_feed_v1
      : LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.change_feed_v1;
    const currentRevision = local
      ? safeInteger(
          this.#database.exec({
            sql: program.countSql,
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "local change-feed sequence",
        )
      : sourceRevision;
    if (request.value.afterRevision > currentRevision) {
      throw new Error("PWA Library SQLite change-feed revision is ahead");
    }
    let upperRevision = currentRevision;
    let afterRevision = request.value.afterRevision;
    let afterOrdinal = 255;
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreChangeFeedCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.upperRevision > currentRevision
      ) {
        throw new Error("PWA Library SQLite change-feed cursor is stale");
      }
      upperRevision = cursor.value.upperRevision;
      afterRevision = cursor.value.revision;
      afterOrdinal = cursor.value.ordinal;
    }
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        upperRevision,
        afterRevision,
        afterOrdinal,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite change feed exceeded its row bound");
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => {
      const resetRequired = nullableBoolean(
        row.resetRequired,
        "change-feed reset marker",
      );
      if (resetRequired === null) {
        throw new Error("change-feed reset marker is null");
      }
      return {
        entityId: nullableText(row.entityId, "change-feed entity identity"),
        ordinal: safeInteger(row.ordinal, "change-feed ordinal"),
        resetRequired,
        revision: safeInteger(row.revision, "change-feed revision"),
        topic: text(row.topic, "change-feed topic"),
      };
    });
    let previousRevision = afterRevision;
    for (const row of rows) {
      if (row.revision > previousRevision + 1 && !row.resetRequired) {
        throw new Error("PWA Library SQLite change feed has a revision gap");
      }
      previousRevision = row.revision;
    }
    const last = rows.at(-1);
    if (
      !hasMore &&
      request.value.afterRevision < upperRevision &&
      last?.revision !== upperRevision
    ) {
      throw new Error("PWA Library SQLite change feed is incomplete");
    }
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreChangeFeedCursorV1({
              afterRevision: request.value.afterRevision,
              generationId: generationId as never,
              ordinal: last.ordinal,
              revision: last.revision,
              upperRevision,
            })
          : null,
      queryId: local
        ? ("local_change_feed_v1" as const)
        : ("change_feed_v1" as const),
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: upperRevision,
        transitionSequence: upperRevision,
      },
    };
    const parsed = local
      ? parseLibraryCoreLocalChangeFeedResponseV1(response, request.value)
      : parseLibraryCoreChangeFeedResponseV1(response, request.value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPreferencesSnapshot(
    input: LibraryCorePreferencesSnapshotRequestV1,
  ): LibraryCorePreferencesSnapshotResponseV1 {
    const request = parseLibraryCorePreferencesSnapshotRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.preferences_snapshot_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length >= program.maximumScanRows) {
      throw new Error("PWA Library SQLite preferences exceed their row bound");
    }
    const response = {
      queryId: "preferences_snapshot_v1" as const,
      rows: rawRows.map((row) => ({
        booleanValue:
          row.booleanValue === null
            ? null
            : nullableBoolean(row.booleanValue, "preference boolean"),
        integerValue: nullableInteger(row.integerValue, "preference integer"),
        path: text(row.path, "preference path"),
        realValue:
          row.realValue === null
            ? null
            : typeof row.realValue === "number" &&
                Number.isFinite(row.realValue)
              ? row.realValue
              : (() => {
                  throw new Error("preference real is invalid");
                })(),
        textValue: nullableText(row.textValue, "preference text"),
        updatedAt: safeInteger(row.updatedAt, "preference update time"),
        valueType: text(row.valueType, "preference value type"),
      })),
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCorePreferencesSnapshotResponseV1(response);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPersonDetail(
    input: LibraryCorePersonDetailRequestV1,
  ): LibraryCorePersonDetailResponseV1 {
    const request = parseLibraryCorePersonDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.person_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.personId],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite person detail exceeded its row bound",
      );
    }
    const row = rows[0];
    const linkedAccounts =
      row === undefined
        ? []
        : (JSON.parse(
            text(row.linkedAccountsJson, "Person linked Account rows"),
          ) as unknown);
    const linkedAccountCount =
      row === undefined
        ? 0
        : safeInteger(row.linkedAccountCount, "Person linked Account count");
    const person =
      row === undefined
        ? null
        : {
            avatarUrl: nullableText(row.avatarUrl, "Person avatar URL"),
            bio: nullableText(row.bio, "Person bio"),
            careLevel: safeInteger(row.careLevel, "Person care level"),
            createdAt: safeInteger(row.createdAt, "Person creation time"),
            id: text(row.id, "Person identity"),
            name: text(row.name, "Person name"),
            notes: nullableText(row.notes, "Person notes"),
            reachOutIntervalDays: nullableInteger(
              row.reachOutIntervalDays,
              "Person reach-out interval",
            ),
            reachOuts: JSON.parse(
              text(row.reachOutsJson, "Person reach-out rows"),
            ) as unknown,
            relationshipStatus: text(
              row.relationshipStatus,
              "Person relationship status",
            ),
            sampleBatchId: nullableText(
              row.sampleBatchId,
              "Person sample batch",
            ),
            sampleGeneratedAt: nullableInteger(
              row.sampleGeneratedAt,
              "Person sample generation time",
            ),
            sampleGeneratorVersion: nullableInteger(
              row.sampleGeneratorVersion,
              "Person sample generator version",
            ),
            tags: stringArray(row.tagsJson, "Person tags"),
            updatedAt: safeInteger(row.updatedAt, "Person update time"),
          };
    const response = {
      linkedAccountCount,
      linkedAccounts,
      person,
      queryId: "person_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCorePersonDetailResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountDetail(
    input: LibraryCoreAccountDetailRequestV1,
  ): LibraryCoreAccountDetailResponseV1 {
    const request = parseLibraryCoreAccountDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.accountId],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite account detail exceeded its row bound",
      );
    }
    const row = rows[0];
    const account =
      row === undefined
        ? null
        : {
            address: nullableText(row.address, "Account address"),
            avatarUrl: nullableText(row.avatarUrl, "Account avatar URL"),
            createdAt: safeInteger(row.createdAt, "Account creation time"),
            discoveredFrom: text(
              row.discoveredFrom,
              "Account discovery source",
            ),
            displayName: nullableText(row.displayName, "Account display name"),
            email: nullableText(row.email, "Account email"),
            externalId: text(row.externalId, "Account external identity"),
            firstSeenAt: safeInteger(row.firstSeenAt, "Account first seen"),
            followRosterActive: nullableBoolean(
              row.followRosterActive,
              "Account follow-roster active",
            ),
            followRosterRoles: stringArray(
              row.followRosterRolesJson,
              "Account follow-roster roles",
            ),
            followRosterSyncedAt: nullableInteger(
              row.followRosterSyncedAt,
              "Account follow-roster sync time",
            ),
            handle: nullableText(row.handle, "Account handle"),
            id: text(row.id, "Account identity"),
            importedAt: nullableInteger(row.importedAt, "Account import time"),
            kind: text(row.kind, "Account kind"),
            lastSeenAt: safeInteger(row.lastSeenAt, "Account last seen"),
            personId: nullableText(row.personId, "Account Person identity"),
            phone: nullableText(row.phone, "Account phone"),
            profileUrl: nullableText(row.profileUrl, "Account profile URL"),
            provider: text(row.provider, "Account provider"),
            sampleBatchId: nullableText(
              row.sampleBatchId,
              "Account sample batch",
            ),
            sampleGeneratedAt: nullableInteger(
              row.sampleGeneratedAt,
              "Account sample generation time",
            ),
            sampleGeneratorVersion: nullableInteger(
              row.sampleGeneratorVersion,
              "Account sample generator version",
            ),
            updatedAt: safeInteger(row.updatedAt, "Account update time"),
          };
    const response = {
      account,
      queryId: "account_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreAccountDetailResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryContactMatch(
    input: LibraryCoreContactMatchRequestV1,
  ): LibraryCoreContactMatchResponseV1 {
    const request = parseLibraryCoreContactMatchRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.contact_match_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [
        JSON.stringify(request.value.names),
        JSON.stringify(request.value.emails),
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length !== 1 || rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite contact match exceeded its row bound",
      );
    }
    const row = rows[0]!;
    const response = {
      accountIds: stringArray(
        row.accountIdsJson,
        "Contact match Account identities",
      ),
      confidence: text(row.confidence, "Contact match confidence"),
      personId: nullableText(row.personId, "Contact match Person identity"),
      queryId: "contact_match_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreContactMatchResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryRssFeedDetail(
    input: LibraryCoreRssFeedDetailRequestV1,
  ): LibraryCoreRssFeedDetailResponseV1 {
    const request = parseLibraryCoreRssFeedDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.rss_feed_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.url],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite RSS Feed detail exceeded its row bound",
      );
    }
    const row = rows[0];
    const feed =
      row === undefined
        ? null
        : {
            enabled: requiredBoolean(row.enabled, "RSS Feed enabled"),
            folder: nullableText(row.folder, "RSS Feed folder"),
            imageUrl: nullableText(row.imageUrl, "RSS Feed image URL"),
            lastFetched: nullableInteger(
              row.lastFetched,
              "RSS Feed last fetched",
            ),
            pollInterval: nullableInteger(
              row.pollInterval,
              "RSS Feed poll interval",
            ),
            sampleBatchId: nullableText(
              row.sampleBatchId,
              "RSS Feed sample batch",
            ),
            sampleGeneratedAt: nullableInteger(
              row.sampleGeneratedAt,
              "RSS Feed sample generation time",
            ),
            sampleGeneratorVersion: nullableInteger(
              row.sampleGeneratorVersion,
              "RSS Feed sample generator version",
            ),
            siteUrl: nullableText(row.siteUrl, "RSS Feed site URL"),
            title: text(row.title, "RSS Feed title"),
            trackUnread: requiredBoolean(
              row.trackUnread,
              "RSS Feed track unread",
            ),
            updatedAt: safeInteger(row.updatedAt, "RSS Feed update time"),
            url: text(row.url, "RSS Feed URL"),
          };
    const response = {
      feed,
      queryId: "rss_feed_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreRssFeedDetailResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPersonGraphPage(
    input: LibraryCorePersonGraphPageRequestV1,
  ): LibraryCorePersonGraphPageResponseV1 {
    const request = parseLibraryCorePersonGraphPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, layoutRevision, sourceRevision } =
      this.#queryGraphSource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.layoutRevision !== layoutRevision ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision)
    ) {
      throw new Error("PWA Library SQLite Person graph cursor is stale");
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.person_graph_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        cursor?.ok ? cursor.value.entityId : null,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Person graph page exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => ({
      avatarUrl: nullableText(row.avatarUrl, "Person graph avatar URL"),
      careLevel: safeInteger(row.careLevel, "Person graph care level"),
      graphPinned: requiredBoolean(
        row.graphPinned,
        "Person graph pinned state",
      ),
      graphUpdatedAt: nullableInteger(
        row.graphUpdatedAt,
        "Person graph position update",
      ),
      graphX: nullableFiniteNumber(row.graphX, "Person graph x position"),
      graphY: nullableFiniteNumber(row.graphY, "Person graph y position"),
      id: text(row.id, "Person graph identity"),
      lastReachOutAt: nullableInteger(
        row.lastReachOutAt,
        "Person graph last reach-out",
      ),
      name: text(row.name, "Person graph name"),
      reachOutIntervalDays: nullableInteger(
        row.reachOutIntervalDays,
        "Person graph reach-out interval",
      ),
      relationshipStatus: text(
        row.relationshipStatus,
        "Person graph relationship status",
      ),
      updatedAt: safeInteger(row.updatedAt, "Person graph update time"),
    }));
    const last = rows.at(-1);
    const response = {
      layoutRevision,
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreIdentityPageCursorV1({
              entityId: last.id,
              generationId,
              layoutRevision,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "person_graph_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCorePersonGraphPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountGraphPage(
    input: LibraryCoreAccountGraphPageRequestV1,
  ): LibraryCoreAccountGraphPageResponseV1 {
    const request = parseLibraryCoreAccountGraphPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, layoutRevision, sourceRevision } =
      this.#queryGraphSource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.layoutRevision !== layoutRevision ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision)
    ) {
      throw new Error("PWA Library SQLite Account graph cursor is stale");
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_graph_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        cursor?.ok ? cursor.value.entityId : null,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Account graph page exceeded its row bound",
      );
    }
    let hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => ({
      activityCount: safeInteger(
        row.activityCount,
        "Account graph activity count",
      ),
      avatarUrl: nullableText(row.avatarUrl, "Account graph avatar URL"),
      discoveredFrom: text(
        row.discoveredFrom,
        "Account graph discovery source",
      ),
      displayName: nullableText(row.displayName, "Account graph display name"),
      externalId: text(row.externalId, "Account graph external identity"),
      firstSeenAt: safeInteger(row.firstSeenAt, "Account graph first seen"),
      followRosterActive: nullableBoolean(
        row.followRosterActive,
        "Account graph follow-roster active",
      ),
      graphPinned: requiredBoolean(
        row.graphPinned,
        "Account graph pinned state",
      ),
      graphUpdatedAt: nullableInteger(
        row.graphUpdatedAt,
        "Account graph position update",
      ),
      graphX: nullableFiniteNumber(row.graphX, "Account graph x position"),
      graphY: nullableFiniteNumber(row.graphY, "Account graph y position"),
      handle: nullableText(row.handle, "Account graph handle"),
      id: text(row.id, "Account graph identity"),
      kind: text(row.kind, "Account graph kind"),
      lastSeenAt: safeInteger(row.lastSeenAt, "Account graph last seen"),
      latestActivityAt: nullableInteger(
        row.latestActivityAt,
        "Account graph latest activity",
      ),
      personId: nullableText(row.personId, "Account graph Person identity"),
      personName: nullableText(row.personName, "Account graph Person name"),
      provider: text(row.provider, "Account graph provider"),
      updatedAt: safeInteger(row.updatedAt, "Account graph update time"),
    }));
    for (;;) {
      const last = rows.at(-1);
      const response = {
        layoutRevision,
        nextCursor:
          hasMore && last
            ? encodeLibraryCoreIdentityPageCursorV1({
                entityId: last.id,
                generationId,
                layoutRevision,
                projectionRevision: sourceRevision,
                transitionSequence: sourceRevision,
              })
            : null,
        queryId: "account_graph_page_v1" as const,
        rows,
        schemaVersion: 1 as const,
        source: {
          generationId,
          projectionRevision: sourceRevision,
          transitionSequence: sourceRevision,
        },
      };
      if (
        new TextEncoder().encode(JSON.stringify(response)).byteLength <=
        LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
      ) {
        const parsed = parseLibraryCoreAccountGraphPageResponseV1(
          response,
          request.value,
        );
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
      }
      if (rows.length <= 1) {
        throw new Error(
          "PWA Library SQLite Account graph page contains an oversized row",
        );
      }
      rows.pop();
      hasMore = true;
    }
  }

  #queryRssFeedPage(
    input: LibraryCoreRssFeedPageRequestV1,
  ): LibraryCoreRssFeedPageResponseV1 {
    const request = parseLibraryCoreRssFeedPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, layoutRevision, sourceRevision } =
      this.#queryGraphSource();
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreIdentityPageCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.generationId !== generationId ||
        cursor.value.layoutRevision !== layoutRevision ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision)
    ) {
      throw new Error("PWA Library SQLite RSS Feed page cursor is stale");
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.rss_feed_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        cursor?.ok ? cursor.value.entityId : null,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite RSS Feed page exceeded its row bound",
      );
    }
    let hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => ({
      activityCount: safeInteger(row.activityCount, "RSS Feed activity count"),
      enabled: requiredBoolean(row.enabled, "RSS Feed enabled"),
      folder: nullableText(row.folder, "RSS Feed folder"),
      imageUrl: nullableText(row.imageUrl, "RSS Feed image URL"),
      lastFetched: nullableInteger(row.lastFetched, "RSS Feed last fetched"),
      latestActivityAt: nullableInteger(
        row.latestActivityAt,
        "RSS Feed latest activity",
      ),
      pollInterval: nullableInteger(row.pollInterval, "RSS Feed poll interval"),
      sampleBatchId: nullableText(row.sampleBatchId, "RSS Feed sample batch"),
      sampleGeneratedAt: nullableInteger(
        row.sampleGeneratedAt,
        "RSS Feed sample generation time",
      ),
      sampleGeneratorVersion: nullableInteger(
        row.sampleGeneratorVersion,
        "RSS Feed sample generator version",
      ),
      siteUrl: nullableText(row.siteUrl, "RSS Feed site URL"),
      title: text(row.title, "RSS Feed title"),
      trackUnread: requiredBoolean(row.trackUnread, "RSS Feed track unread"),
      unreadCount: safeInteger(row.unreadCount, "RSS Feed unread count"),
      updatedAt: safeInteger(row.updatedAt, "RSS Feed update time"),
      url: text(row.url, "RSS Feed URL"),
    }));
    for (;;) {
      const last = rows.at(-1);
      const response = {
        layoutRevision,
        nextCursor:
          hasMore && last
            ? encodeLibraryCoreIdentityPageCursorV1({
                entityId: last.url,
                generationId,
                layoutRevision,
                projectionRevision: sourceRevision,
                transitionSequence: sourceRevision,
              })
            : null,
        queryId: "rss_feed_page_v1" as const,
        rows,
        schemaVersion: 1 as const,
        source: {
          generationId,
          projectionRevision: sourceRevision,
          transitionSequence: sourceRevision,
        },
      };
      if (
        new TextEncoder().encode(JSON.stringify(response)).byteLength <=
        LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES
      ) {
        const parsed = parseLibraryCoreRssFeedPageResponseV1(
          response,
          request.value,
        );
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
      }
      if (rows.length <= 1) {
        throw new Error(
          "PWA Library SQLite RSS Feed page contains an oversized row",
        );
      }
      rows.pop();
      hasMore = true;
    }
  }

  #queryPersonsGraph(
    input: LibraryCorePersonsGraphRequestV1,
  ): LibraryCorePersonsGraphResponseV1 {
    const request = parseLibraryCorePersonsGraphRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.persons_graph_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        JSON.stringify(request.value.sources),
        JSON.stringify(request.value.rssFeedUrls),
        request.value.recentWindow.startMs,
        request.value.recentWindow.endMs,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    const expectedRows =
      request.value.sources.length + request.value.rssFeedUrls.length;
    if (
      rawRows.length !== expectedRows ||
      rawRows.length > program.maximumScanRows
    ) {
      throw new Error("PWA Library SQLite persons graph row count is invalid");
    }
    const parseArray = (
      value: SqlValue | undefined,
      label: string,
    ): unknown[] => {
      const parsed = JSON.parse(text(value, label)) as unknown;
      if (!Array.isArray(parsed)) throw new Error(`${label} is not an array`);
      return parsed;
    };
    const social = request.value.sources.map((source, index) => {
      const row = rawRows[index]!;
      if (
        row.kind !== "social" ||
        row.platform !== source.platform ||
        row.authorId !== source.authorId ||
        row.feedUrl !== null
      ) {
        throw new Error(
          "PWA Library SQLite persons graph social order is invalid",
        );
      }
      const samples = parseArray(row.sampleItemsJson, "persons graph samples");
      const locations = parseArray(
        row.locationCandidatesJson,
        "persons graph locations",
      );
      const sparseSignals = parseArray(
        row.signalCountsJson,
        "persons graph signals",
      );
      const signalCounts = CONTENT_SIGNAL_KEYS.map((label) => {
        const matches = sparseSignals.filter(
          (value) =>
            value !== null &&
            typeof value === "object" &&
            Object.getPrototypeOf(value) === Object.prototype &&
            (value as Record<string, unknown>).label === label,
        );
        if (matches.length > 1) {
          throw new Error(
            "PWA Library SQLite persons graph signal is duplicated",
          );
        }
        const count = matches.length
          ? (matches[0] as Record<string, unknown>).count
          : 0;
        if (typeof count !== "number") {
          throw new Error(
            "PWA Library SQLite persons graph signal count is invalid",
          );
        }
        return { count, label };
      });
      return {
        authorId: source.authorId,
        avatarGlobalId: nullableText(
          row.avatarGlobalId,
          "persons graph avatar item",
        ),
        avatarPublishedAt: nullableInteger(
          row.avatarPublishedAt,
          "persons graph avatar time",
        ),
        avatarUrl: nullableText(row.avatarUrl, "persons graph avatar URL"),
        hasLocation: locations.length > 0,
        itemCount: safeInteger(row.itemCount, "persons graph item count"),
        latestActivityAt: safeInteger(
          row.latestActivityAt,
          "persons graph latest activity",
        ),
        locationCandidateCount: locations.length,
        locationCandidates: locations,
        platform: source.platform,
        recentCount: safeInteger(row.recentCount, "persons graph recent count"),
        sampleItems: samples,
        signalCounts,
      };
    });
    const rss = request.value.rssFeedUrls.map((feedUrl, rssIndex) => {
      const row = rawRows[request.value.sources.length + rssIndex]!;
      if (
        row.kind !== "rss" ||
        row.feedUrl !== feedUrl ||
        row.platform !== null ||
        row.authorId !== null
      ) {
        throw new Error(
          "PWA Library SQLite persons graph RSS order is invalid",
        );
      }
      const samples = parseArray(
        row.sampleItemsJson,
        "persons graph RSS samples",
      );
      const locations = parseArray(
        row.locationCandidatesJson,
        "persons graph RSS locations",
      );
      return {
        avatarGlobalId: nullableText(
          row.avatarGlobalId,
          "persons graph RSS avatar item",
        ),
        avatarPublishedAt: nullableInteger(
          row.avatarPublishedAt,
          "persons graph RSS avatar time",
        ),
        avatarUrl: nullableText(row.avatarUrl, "persons graph RSS avatar URL"),
        feedUrl,
        hasLocation: locations.length > 0,
        itemCount: safeInteger(row.itemCount, "persons graph RSS item count"),
        latestActivityAt: safeInteger(
          row.latestActivityAt,
          "persons graph RSS latest activity",
        ),
        locationCandidateCount: locations.length,
        locationCandidates: locations,
        sampleItems: samples,
      };
    });
    const totalRows = this.#database.exec({
      sql: program.countSql,
      rowMode: 0,
      returnValue: "resultRows",
    });
    const response = {
      queryId: "persons_graph_v1" as const,
      rss,
      schemaVersion: 1 as const,
      social,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalItemCount: safeInteger(
        totalRows[0],
        "persons graph total item count",
      ),
    };
    const parsed = parseLibraryCorePersonsGraphResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFilterScopeSummary(
    input: LibraryCoreFilterScopeSummaryRequestV1,
  ): LibraryCoreFilterScopeSummaryResponseV1 {
    const request = parseLibraryCoreFilterScopeSummaryRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.filter_scope_summary_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.feedUrl,
        request.value.platform,
        request.value.authorId,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length !== program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite filter scope summary returned an invalid row count",
      );
    }
    const row = rows[0]!;
    const response = {
      accountId: nullableText(row.accountId, "filter scope Account identity"),
      itemCount: safeInteger(row.itemCount, "filter scope item count"),
      label: nullableText(row.label, "filter scope label"),
      queryId: "filter_scope_summary_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreFilterScopeSummaryResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFriendsDirectory(
    input: LibraryCoreFriendsDirectoryPageRequestV1,
  ): LibraryCoreFriendsDirectoryPageResponseV1 {
    const request = parseLibraryCoreFriendsDirectoryPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const bindingDigest = libraryCoreFriendsDirectoryBindingDigestV1(
      request.value,
    );
    const cursor =
      request.value.cursor === null
        ? null
        : decodeLibraryCoreFriendsDirectoryCursorV1(request.value.cursor);
    if (
      cursor !== null &&
      (!cursor.ok ||
        cursor.value.bindingDigest !== bindingDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision)
    ) {
      throw new Error("PWA Library SQLite Friends directory cursor is stale");
    }
    const offset = cursor?.ok ? cursor.value.offset : 0;
    const filters = new Set(request.value.filters);
    const cutoff = Math.max(
      0,
      request.value.nowMs - LIBRARY_CORE_FRIENDS_DIRECTORY_RECENT_WINDOW_MS,
    );
    const filterBindings = [
      request.value.search,
      filters.has("need_outreach") ? 1 : 0,
      filters.has("no_contact") ? 1 : 0,
      filters.has("close_friends") ? 1 : 0,
      filters.has("recently_active") ? 1 : 0,
      filters.has("has_location") ? 1 : 0,
      request.value.nowMs,
      cutoff,
    ] as const;
    const program =
      LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.friends_directory_page_v1;
    const countRows = this.#database.exec({
      sql: program.countSql,
      bind: filterBindings,
      rowMode: 0,
      returnValue: "resultRows",
    });
    if (countRows.length !== 1) {
      throw new Error("PWA Library SQLite Friends directory count is invalid");
    }
    const totalCount = safeInteger(
      countRows[0],
      "Friends directory total count",
    );
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        ...filterBindings,
        request.value.sort,
        offset,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Friends directory exceeded its row bound",
      );
    }
    let hasMore = rawRows.length > request.value.limit;
    const rows = rawRows.slice(0, request.value.limit).map((row) => {
      const parsed = coerceLibraryCoreGeneratedSqliteQueryRow(
        "friends_directory_page_v1",
        row,
      );
      if (!parsed) {
        throw new Error("PWA Library SQLite Friends directory row is invalid");
      }
      return parsed;
    });
    for (;;) {
      const response = {
        nextCursor:
          hasMore && rows.length > 0
            ? encodeLibraryCoreFriendsDirectoryCursorV1({
                bindingDigest,
                generationId: generationId as never,
                offset: offset + rows.length,
                projectionRevision: sourceRevision,
                transitionSequence: sourceRevision,
              })
            : null,
        queryId: "friends_directory_page_v1" as const,
        rows,
        schemaVersion: 1 as const,
        source: {
          generationId,
          projectionRevision: sourceRevision,
          transitionSequence: sourceRevision,
        },
        totalCount,
      };
      if (
        new TextEncoder().encode(JSON.stringify(response)).byteLength <=
        LIBRARY_CORE_FRIENDS_DIRECTORY_MAXIMUM_RESPONSE_BYTES
      ) {
        const parsed = parseLibraryCoreFriendsDirectoryPageResponseV1(
          response,
          request.value,
        );
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
      }
      if (rows.length <= 1) {
        throw new Error(
          "PWA Library SQLite Friends directory contains an oversized row",
        );
      }
      rows.pop();
      hasMore = true;
    }
  }

  #queryPersonPickerPage(
    input: LibraryCorePersonPickerPageRequestV1,
  ): LibraryCorePersonPickerPageResponseV1 {
    const request = parseLibraryCorePersonPickerPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const pattern = `${request.value.search
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_")}%`;
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.person_picker_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [pattern, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Person picker exceeded its row bound",
      );
    }
    const rows = rawRows.slice(0, request.value.limit).map((row) => {
      const parsed = coerceLibraryCoreGeneratedSqliteQueryRow(
        "person_picker_page_v1",
        row,
      );
      if (!parsed) {
        throw new Error("PWA Library SQLite Person picker row is invalid");
      }
      return parsed;
    });
    const response = {
      queryId: "person_picker_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCorePersonPickerPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountPickerPage(
    input: LibraryCoreAccountPickerPageRequestV1,
  ): LibraryCoreAccountPickerPageResponseV1 {
    const request = parseLibraryCoreAccountPickerPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_picker_page_v1;
    const hasSearch = request.value.search.length > 0;
    const variant = hasSearch
      ? program.variants.search
      : program.variants.empty;
    const ftsPhrase = `"${request.value.search.replaceAll('"', '""')}"`;
    const rawRows = this.#database.exec({
      sql: variant.sql,
      bind: hasSearch
        ? [ftsPhrase, request.value.limit + 1]
        : [request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Account picker exceeded its row bound",
      );
    }
    const rows = rawRows.slice(0, request.value.limit).map((row) => {
      const parsed = coerceLibraryCoreGeneratedSqliteQueryRow(
        "account_picker_page_v1",
        row,
      );
      if (!parsed) {
        throw new Error("PWA Library SQLite Account picker row is invalid");
      }
      return parsed;
    });
    const response = {
      queryId: "account_picker_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreAccountPickerPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountLinkCandidates(
    input: LibraryCoreAccountLinkCandidatesRequestV1,
  ): LibraryCoreAccountLinkCandidatesResponseV1 {
    const request = parseLibraryCoreAccountLinkCandidatesRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program =
      LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_link_candidates_v1;
    const variant = program.variants[request.value.entityKind];
    const rawRows = this.#database.exec({
      sql: variant.sql,
      bind: [request.value.entityId, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Account link candidates exceeded its row bound",
      );
    }
    const rows = rawRows.slice(0, request.value.limit).map((row) => {
      const parsed = coerceLibraryCoreGeneratedSqliteQueryRow(
        "account_link_candidates_v1",
        row,
      );
      if (!parsed) {
        throw new Error(
          "PWA Library SQLite Account link candidate row is invalid",
        );
      }
      return parsed;
    });
    const response = {
      queryId: "account_link_candidates_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreAccountLinkCandidatesResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFriendCandidateReview(
    input: LibraryCoreFriendCandidateReviewRequestV1,
  ): LibraryCoreFriendCandidateReviewResponseV1 {
    const request = parseLibraryCoreFriendCandidateReviewRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program =
      LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.friend_candidate_review_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        JSON.stringify(request.value.contactPersonIds),
        JSON.stringify(request.value.contactAccountIds),
        JSON.stringify(request.value.dismissedSuggestionIds),
        request.value.nowMs,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Friend candidate review exceeded its row bound",
      );
    }
    const rows = rawRows.slice(0, request.value.limit).map((row) => {
      const parsed = coerceLibraryCoreGeneratedSqliteQueryRow(
        "friend_candidate_review_v1",
        row,
      );
      if (!parsed) {
        throw new Error(
          "PWA Library SQLite Friend candidate review row is invalid",
        );
      }
      return parsed;
    });
    const response = {
      queryId: "friend_candidate_review_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreFriendCandidateReviewResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFacetSummary(
    input: LibraryCoreFacetSummaryRequestV1,
  ): LibraryCoreFacetSummaryResponseV1 {
    const request = parseLibraryCoreFacetSummaryRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.library_facet_summary_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length !== program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite facet query returned an invalid row count",
      );
    }
    const row = rows[0]!;
    const response = {
      queryId: "library_facet_summary_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      summary: {
        archivedCount: safeInteger(row.archivedCount, "archived count"),
        archivableCount: safeInteger(row.archivableCount, "archivable count"),
        contactAccountCount: safeInteger(
          row.contactAccountCount,
          "contact Account count",
        ),
        contactLinkedPersonCount: safeInteger(
          row.contactLinkedPersonCount,
          "linked contact Person count",
        ),
        enabledRssFeedCount: safeInteger(
          row.enabledRssFeedCount,
          "enabled RSS Feed count",
        ),
        friendPersonCount: safeInteger(
          row.friendPersonCount,
          "friend Person count",
        ),
        latestContactImportedAt: nullableInteger(
          row.latestContactImportedAt,
          "latest contact import",
        ),
        latestRssFeedFetchedAt: nullableInteger(
          row.latestRssFeedFetchedAt,
          "latest RSS Feed fetch",
        ),
        platformCounts: JSON.parse(
          text(row.platformCountsJson, "platform counts"),
        ) as unknown,
        sampleAccountCount: safeInteger(
          row.sampleAccountCount,
          "sample account count",
        ),
        sampleFeedCount: safeInteger(row.sampleFeedCount, "sample feed count"),
        sampleItemCount: safeInteger(row.sampleItemCount, "sample item count"),
        samplePersonCount: safeInteger(
          row.samplePersonCount,
          "sample person count",
        ),
        rssFeedCount: safeInteger(row.rssFeedCount, "RSS Feed count"),
        savedArchivedCount: safeInteger(
          row.savedArchivedCount,
          "saved archived count",
        ),
        savedCount: safeInteger(row.savedCount, "saved count"),
        savedPlatformCount: safeInteger(
          row.savedPlatformCount,
          "saved platform count",
        ),
        socialAccountCount: safeInteger(
          row.socialAccountCount,
          "social Account count",
        ),
        tags: stringArray(row.tagsJson, "facet tags"),
        totalCount: safeInteger(row.totalCount, "total count"),
        unreadCount: safeInteger(row.unreadCount, "unread count"),
      },
    };
    const parsed = parseLibraryCoreFacetSummaryResponseV1(response);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #querySavedAnalytics(
    input: LibraryCoreSavedAnalyticsRequestV2,
  ): LibraryCoreSavedAnalyticsResponseV2 {
    const request = parseLibraryCoreSavedAnalyticsRequestV2(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.saved_analytics_v2;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [
        JSON.stringify(request.value.dailyWindows),
        JSON.stringify(request.value.hourlyWindows),
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length !== program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite saved analytics returned an invalid row count",
      );
    }
    const row = rows[0]!;
    const response = {
      contentMix: JSON.parse(
        text(row.contentMixJson, "saved content mix"),
      ) as unknown,
      dailyCounts: JSON.parse(
        text(row.dailyCountsJson, "saved daily counts"),
      ) as unknown,
      hourlyCounts: JSON.parse(
        text(row.hourlyCountsJson, "saved hourly counts"),
      ) as unknown,
      latestSavedAt: nullableInteger(row.latestSavedAt, "latest saved time"),
      queryId: "saved_analytics_v2" as const,
      schemaVersion: 2 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      sourceCounts: JSON.parse(
        text(row.sourceCountsJson, "saved source counts"),
      ) as unknown,
      totalCount: safeInteger(row.totalCount, "saved total count"),
    };
    const parsed = parseLibraryCoreSavedAnalyticsResponseV2(response);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryItemDetail(
    input: LibraryCoreItemDetailRequestV1,
  ): LibraryCoreItemDetailResponseV1 {
    const request = parseLibraryCoreItemDetailRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.item_detail_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.globalId],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite item detail exceeded its row bound");
    }
    const row = rows[0];
    const response = {
      item:
        row === undefined
          ? null
          : {
              card: feedCardFromSqliteRow(row),
              contentBody: {
                blobDigest: nullableText(
                  row.contentBodyBlobDigest,
                  "content body digest",
                ),
                storage: text(row.contentBodyStorage, "content body storage"),
              },
              mediaBlobDigests: JSON.parse(
                text(row.mediaBlobDigestsJson, "media blob digests"),
              ) as unknown,
              preservedBody: {
                blobDigest: nullableText(
                  row.preservedBodyBlobDigest,
                  "preserved body digest",
                ),
                storage: text(
                  row.preservedBodyStorage,
                  "preserved body storage",
                ),
              },
            },
      queryId: "item_detail_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreItemDetailResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryItemReaderBody(
    input: LibraryCoreItemReaderBodyRequestV1,
  ): LibraryCoreItemReaderBodyResponseV1 {
    const request = parseLibraryCoreItemReaderBodyRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.item_reader_body_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.globalId,
        request.value.bodyKind,
        request.value.offsetBytes,
        request.value.limitBytes,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite reader body exceeded its row bound");
    }
    const metadata = rows[0];
    let body = null;
    if (metadata !== undefined) {
      if (safeInteger(metadata.chunkIndex, "reader metadata row") !== -1) {
        throw new Error("PWA Library SQLite reader metadata row is missing");
      }
      const storage = text(metadata.bodyStorage, "reader body storage");
      const contentLength = safeInteger(
        metadata.contentLength,
        "reader content length",
      );
      if (request.value.offsetBytes > contentLength) {
        throw new RangeError("reader body offset exceeds content length");
      }
      const endOffset = Math.min(
        contentLength,
        request.value.offsetBytes + request.value.limitBytes,
      );
      let range = new Uint8Array();
      if (request.value.offsetBytes < contentLength && storage === "inline") {
        const bytes = blobBytes(metadata.bytes, "inline reader body");
        if (bytes.byteLength !== contentLength) {
          throw new Error("inline reader body length is inconsistent");
        }
        range = bytes.slice(request.value.offsetBytes, endOffset);
      } else if (
        request.value.offsetBytes < contentLength &&
        storage === "blob"
      ) {
        const firstChunk = Math.floor(request.value.offsetBytes / 65_536);
        const lastChunk = Math.floor((endOffset - 1) / 65_536);
        const chunks = rows.slice(1);
        if (chunks.length !== lastChunk - firstChunk + 1) {
          throw new Error("reader body chunk range is incomplete");
        }
        const joined = new Uint8Array(
          chunks.reduce(
            (total, row) =>
              total + blobBytes(row.bytes, "reader body chunk").byteLength,
            0,
          ),
        );
        let writeOffset = 0;
        for (const [index, row] of chunks.entries()) {
          if (
            safeInteger(row.chunkIndex, "reader chunk index") !==
            firstChunk + index
          ) {
            throw new Error("reader body chunks are not contiguous");
          }
          const bytes = blobBytes(row.bytes, "reader body chunk");
          joined.set(bytes, writeOffset);
          writeOffset += bytes.byteLength;
        }
        const relativeStart = request.value.offsetBytes - firstChunk * 65_536;
        range = joined.slice(
          relativeStart,
          relativeStart + endOffset - request.value.offsetBytes,
        );
      }
      body = {
        blobDigest: nullableText(metadata.blobDigest, "reader body digest"),
        bytesBase64: encodeLibraryCoreCanonicalBase64(range),
        contentLength,
        endOffset: request.value.offsetBytes + range.byteLength,
        startOffset: request.value.offsetBytes,
        storage,
      };
    }
    const response = {
      body,
      queryId: "item_reader_body_v1" as const,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreItemReaderBodyResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryItemScan(
    input: LibraryCoreItemScanRequestV1,
  ): LibraryCoreItemScanResponseV1 {
    const request = parseLibraryCoreItemScanRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    let afterGlobalId: string | null = null;
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreItemScanCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite item scan cursor is stale");
      }
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.background_item_page_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [afterGlobalId, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite item scan exceeded its row bound");
    }
    const hasMore = rows.length > request.value.limit;
    const cards = rows.slice(0, request.value.limit).map((row) => {
      const hiddenState = safeInteger(row.hidden, "hidden state");
      const rssFeedUrl = nullableText(row.rssFeedUrl, "RSS feed URL");
      const sampleBatchId = nullableText(row.sampleBatchId, "sample batch ID");
      const sampleGeneratedAt =
        row.sampleGeneratedAt === null
          ? null
          : safeInteger(row.sampleGeneratedAt, "sample generation time");
      const sampleGeneratorVersion =
        row.sampleGeneratorVersion === null
          ? null
          : safeInteger(row.sampleGeneratorVersion, "sample generator version");
      if (
        ![0, 1].includes(hiddenState) ||
        (sampleBatchId === null) !== (sampleGeneratedAt === null) ||
        (sampleBatchId === null) !== (sampleGeneratorVersion === null)
      ) {
        throw new Error("PWA Library SQLite sample provenance is incomplete");
      }
      return {
        ...feedCardFromSqliteRow(row),
        hidden: hiddenState === 1,
        rssSource:
          rssFeedUrl === null
            ? null
            : {
                feedTitle: text(row.rssFeedTitle, "RSS feed title"),
                feedUrl: rssFeedUrl,
                siteUrl: text(row.rssSiteUrl, "RSS site URL"),
              },
        sampleDataFingerprint:
          sampleBatchId === null
            ? null
            : {
                batchId: sampleBatchId,
                generatedAt: sampleGeneratedAt!,
                generatorVersion: sampleGeneratorVersion!,
                marker: "freed.sample-data.v1" as const,
              },
      };
    });
    const last = cards.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreItemScanCursorV1({
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "background_item_page_v1" as const,
      rows: cards,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreItemScanResponseV1(response, request.value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryContentFetchPage(
    input: LibraryCoreContentFetchPageRequestV1,
  ): LibraryCoreContentFetchPageResponseV1 {
    const request = parseLibraryCoreContentFetchPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreContentFetchPageCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite content fetch cursor is stale");
      }
      afterPublishedAt = cursor.value.publishedAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.content_fetch_claim_v1;
    const rows = this.#database.exec({
      sql: program.sql,
      bind: [afterPublishedAt, afterGlobalId, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite content fetch exceeded its row bound",
      );
    }
    const hasMore = rows.length > request.value.limit;
    const candidates = rows.slice(0, request.value.limit).map((row) => ({
      capturedAt: safeInteger(row.capturedAt, "content fetch capture time"),
      globalId: text(row.globalId, "content fetch global ID"),
      linkUrl: text(row.linkUrl, "content fetch URL"),
      publishedAt: safeInteger(
        row.publishedAt,
        "content fetch publication time",
      ),
    }));
    const last = candidates.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreContentFetchPageCursorV1({
              generationId: generationId as never,
              globalId: last.globalId as never,
              projectionRevision: sourceRevision,
              publishedAt: last.publishedAt,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "content_fetch_claim_v1" as const,
      rows: candidates,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreContentFetchPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryProviderMediaPage(
    input: LibraryCoreProviderMediaPageRequestV1,
  ): LibraryCoreProviderMediaPageResponseV1 {
    const request = parseLibraryCoreProviderMediaPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const filterDigest = libraryCoreProviderMediaBindingDigestV1(
      request.value.provider,
      request.value.savedOnly,
    );
    let afterGlobalId: string | null = null;
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreProviderMediaPageCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.filterDigest !== filterDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.projectionRevision !== sourceRevision ||
        cursor.value.transitionSequence !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite provider media cursor is stale");
      }
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.provider_media_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.provider,
        request.value.savedOnly ? 1 : 0,
        afterGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite provider media query exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreProviderMediaRowV1[] = rawRows
      .slice(0, request.value.limit)
      .map((row) => {
        const card = feedCardFromSqliteRow(row);
        const groupId = nullableText(row.fbGroupId, "provider media group ID");
        return {
          ...card,
          fbGroup:
            groupId === null
              ? null
              : {
                  id: groupId,
                  name:
                    nullableText(
                      row.fbGroupName,
                      "provider media group name",
                    ) ?? "",
                  url:
                    nullableText(row.fbGroupUrl, "provider media group URL") ??
                    "",
                },
          linkUrl: nullableText(row.linkUrl, "provider media link URL"),
        };
      });
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last
          ? encodeLibraryCoreProviderMediaPageCursorV1({
              filterDigest,
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "provider_media_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreProviderMediaPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFeedPage(
    input: LibraryCoreFeedPageRequestV1,
  ): LibraryCoreFeedPageResponseV1 {
    const request = parseLibraryCoreFeedPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreFeedPageCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite feed cursor is stale");
      }
      afterPublishedAt = cursor.value.sortAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.feed_page_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [afterPublishedAt, afterGlobalId, request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite feed query exceeded its row bound");
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreFeedCardV1[] = rawRows
      .slice(0, request.value.limit)
      .map(feedCardFromSqliteRow);
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last?.publishedAt !== null && last !== undefined
          ? encodeLibraryCoreFeedPageCursorV1({
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              sortAt: last.publishedAt,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "feed_page_v1",
      rows,
      schemaVersion: 1,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "feed total count",
      ),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(response)).byteLength;
    if (bytes > LIBRARY_CORE_FEED_PAGE_MAXIMUM_RESPONSE_BYTES) {
      throw new Error(
        "PWA Library SQLite feed response exceeded its byte bound",
      );
    }
    const parsed = parseLibraryCoreFeedPageResponseV1(response, request.value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryFeedBrowsePage(
    input: LibraryCoreFeedBrowsePageRequestV3,
  ): LibraryCoreFeedBrowsePageResponseV3 {
    const request = parseLibraryCoreFeedBrowsePageRequestV3(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const filterDigest = libraryCoreFeedBrowseBindingDigestV3(
      request.value.filter,
      request.value.identityMode,
    );
    let cursorPriority: number | null = null;
    let cursorPublishedAt: number | null = null;
    let cursorGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreFeedBrowsePageCursorV2(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite browse cursor is stale");
      }
      cursorPriority = cursor.value.priority;
      cursorPublishedAt = cursor.value.publishedAt;
      cursorGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.feed_browse_page_v3;
    const filterBindings: SqlValue[] = [
      request.value.filter.archivedOnly ? 1 : 0,
      request.value.filter.showHidden ? 1 : 0,
      request.value.filter.platform,
      request.value.filter.authorId,
      request.value.filter.feedUrl,
      request.value.filter.socialContentFilter,
      request.value.filter.savedOnly ? 1 : 0,
      JSON.stringify(request.value.filter.tags),
      JSON.stringify(request.value.filter.signals),
      request.value.identityMode,
    ];
    const rawRows = this.#database.exec({
      sql:
        request.value.direction === "previous"
          ? program.reverseSql
          : program.sql,
      bind: [
        ...filterBindings,
        cursorPriority,
        cursorPublishedAt,
        cursorGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite browse query exceeded its row bound");
    }
    const hasMoreInDirection = rawRows.length > request.value.limit;
    const selectedRows = rawRows.slice(0, request.value.limit);
    if (request.value.direction === "previous") selectedRows.reverse();
    const rows = selectedRows.map((row) => ({
      card: feedCardFromSqliteRow(row),
      priority: safeInteger(row.browsePriority, "browse priority"),
    }));
    if (rows.some((row) => row.priority < 0 || row.priority > 100)) {
      throw new Error("PWA Library SQLite browse priority is invalid");
    }
    const edge = (row: (typeof rows)[number] | undefined) =>
      row
        ? {
            cursor: encodeLibraryCoreFeedBrowsePageCursorV2({
              filterDigest,
              generationId: generationId as never,
              globalId: row.card.globalId,
              priority: row.priority,
              projectionRevision: sourceRevision,
              publishedAt: row.card.publishedAt ?? 0,
              transitionSequence: sourceRevision,
            }),
            order: {
              globalId: row.card.globalId,
              priority: row.priority,
              publishedAt: row.card.publishedAt ?? 0,
            },
          }
        : null;
    const nextAvailable =
      request.value.direction === "next" ? hasMoreInDirection : rows.length > 0;
    const previousAvailable =
      request.value.direction === "previous"
        ? hasMoreInDirection
        : request.value.cursor !== null && rows.length > 0;
    const next = nextAvailable ? edge(rows.at(-1)) : null;
    const previous = previousAvailable ? edge(rows[0]) : null;
    const response = {
      filter: request.value.filter,
      friendsPredicateSchemaVersion:
        request.value.friendsPredicateSchemaVersion,
      identityMode: request.value.identityMode,
      nextCursor: next?.cursor ?? null,
      nextOrder: next?.order ?? null,
      previousCursor: previous?.cursor ?? null,
      previousOrder: previous?.order ?? null,
      queryId: "feed_browse_page_v3" as const,
      rankingClockMs: request.value.rankingClockMs,
      recommendationOrderSchemaVersion:
        request.value.recommendationOrderSchemaVersion,
      rows: rows.map((row) => row.card),
      schemaVersion: 3 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: filterBindings,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "browse total count",
      ),
    };
    const parsed = parseLibraryCoreFeedBrowsePageResponseV3(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #querySavedFeedPage(
    input: LibraryCoreSavedFeedPageRequestV2,
  ): LibraryCoreSavedFeedPageResponseV2 {
    const request = parseLibraryCoreSavedFeedPageRequestV2(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const filterDigest = libraryCoreFeedBrowseFilterDigestV1(
      request.value.filter,
    );
    let cursorSortGroup: number | null = null;
    let cursorSortPrimary: number | null = null;
    let cursorSortSecondary: number | null = null;
    let cursorGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreSavedFeedPageCursorV2(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.generationId !== generationId ||
        cursor.value.sourceRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite saved cursor is stale");
      }
      cursorSortGroup = cursor.value.sortGroup;
      cursorSortPrimary = cursor.value.sortPrimary;
      cursorSortSecondary = cursor.value.sortSecondary;
      cursorGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.saved_feed_page_v2;
    const variant = program.variants[request.value.sortMode];
    const filterBindings: SqlValue[] = [
      request.value.filter.archivedOnly ? 1 : 0,
      request.value.filter.platform,
      request.value.filter.authorId,
      request.value.filter.feedUrl,
      request.value.filter.socialContentFilter,
      JSON.stringify(request.value.filter.tags),
      JSON.stringify(request.value.filter.signals),
    ];
    const rawRows = this.#database.exec({
      sql:
        request.value.direction === "previous"
          ? variant.reverseSql
          : variant.sql,
      bind: [
        ...filterBindings,
        cursorSortGroup,
        cursorSortPrimary,
        cursorSortSecondary,
        cursorGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite saved query exceeded its row bound");
    }
    const hasMoreInDirection = rawRows.length > request.value.limit;
    const selectedRows = rawRows.slice(0, request.value.limit);
    if (request.value.direction === "previous") selectedRows.reverse();
    const rows = selectedRows.map((row) => ({
      card: savedFeedCardFromSqliteRow(row),
      sortGroup: safeInteger(row.sortGroup, "saved sort group"),
      sortPrimary: safeInteger(row.sortPrimary, "saved primary sort"),
      sortSecondary: safeInteger(row.sortSecondary, "saved secondary sort"),
    }));
    if (
      rows.some(
        (row) =>
          row.sortGroup < 0 ||
          row.sortGroup > 100 ||
          row.sortPrimary < 0 ||
          row.sortSecondary < 0,
      )
    ) {
      throw new Error("PWA Library SQLite saved order is invalid");
    }
    const edge = (row: (typeof rows)[number] | undefined) =>
      row
        ? {
            cursor: encodeLibraryCoreSavedFeedPageCursorV2({
              filterDigest,
              generationId: generationId as never,
              globalId: row.card.globalId,
              sortGroup: row.sortGroup,
              sortMode: request.value.sortMode,
              sortPrimary: row.sortPrimary,
              sortSecondary: row.sortSecondary,
              sourceRevision,
            }),
            order: {
              globalId: row.card.globalId,
              sortGroup: row.sortGroup,
              sortPrimary: row.sortPrimary,
              sortSecondary: row.sortSecondary,
            },
          }
        : null;
    const nextAvailable =
      request.value.direction === "next" ? hasMoreInDirection : rows.length > 0;
    const previousAvailable =
      request.value.direction === "previous"
        ? hasMoreInDirection
        : request.value.cursor !== null && rows.length > 0;
    const next = nextAvailable ? edge(rows.at(-1)) : null;
    const previous = previousAvailable ? edge(rows[0]) : null;
    const response = {
      filter: request.value.filter,
      nextCursor: next?.cursor ?? null,
      nextOrder: next?.order ?? null,
      previousCursor: previous?.cursor ?? null,
      previousOrder: previous?.order ?? null,
      queryId: "saved_feed_page_v2" as const,
      rows: rows.map((row) => row.card),
      schemaVersion: 2 as const,
      sortMode: request.value.sortMode,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: filterBindings,
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "saved total count",
      ),
    };
    const parsed = parseLibraryCoreSavedFeedPageResponseV2(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #querySearchPage(
    input: LibraryCoreSearchPageRequestV1,
  ): LibraryCoreSearchPageResponseV1 {
    const request = parseLibraryCoreSearchPageRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const searchDigest = libraryCoreSearchPageRequestDigestV1(request.value);
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreSearchPageCursorV1(request.value.cursor);
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.searchDigest !== searchDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite search cursor is stale");
      }
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.search_page_v1;
    const filter = request.value.filter;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        filter.archivedOnly ? 1 : 0,
        filter.showHidden ? 1 : 0,
        filter.platform,
        filter.authorId,
        filter.feedUrl,
        filter.socialContentFilter,
        filter.savedOnly ? 1 : 0,
        JSON.stringify(filter.tags),
        JSON.stringify(filter.signals),
        request.value.identityMode,
        afterGlobalId,
        program.maximumScanRows,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite search exceeded its scan bound");
    }
    const queryTerms = tokenizeLibraryCoreSearchTextV1(request.value.query, 32);
    const rows: LibraryCoreSearchPageResponseV1["rows"][number][] = [];
    let scannedRows = 0;
    let lastScanned: Record<string, SqlValue> | undefined;
    for (const row of rawRows) {
      scannedRows += 1;
      lastScanned = row;
      const score = searchScoreFromSqliteRow(row, queryTerms);
      if (score > 0) {
        rows.push({
          card: feedCardFromSqliteRow(row),
          priority: safeInteger(row.searchPriority, "search priority"),
          score,
        });
      }
      if (rows.length === request.value.limit) break;
    }
    const nextCursor =
      (rows.length === request.value.limit ||
        scannedRows === program.maximumScanRows) &&
      lastScanned
        ? (() => {
            const globalId = text(lastScanned.globalId, "search scan edge");
            if (!isLibraryCoreEntityId(globalId)) {
              throw new Error(
                "PWA Library SQLite search returned an invalid entity identity",
              );
            }
            return encodeLibraryCoreSearchPageCursorV1({
              generationId: generationId as never,
              globalId,
              projectionRevision: sourceRevision,
              searchDigest,
              sortAt: 0,
              transitionSequence: sourceRevision,
            });
          })()
        : null;
    const response = {
      nextCursor,
      queryId: "search_page_v1" as const,
      rows,
      scannedRows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreSearchPageResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryAccountTimeline(
    input: LibraryCoreAccountTimelineRequestV1,
  ): LibraryCoreAccountTimelineResponseV1 {
    const request = parseLibraryCoreAccountTimelineRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const accountDigest = libraryCoreAccountTimelineAccountDigestV1(
      request.value.accountId,
    );
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCoreAccountTimelineCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.accountDigest !== accountDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite account timeline cursor is stale");
      }
      afterPublishedAt = cursor.value.sortAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.account_timeline_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.accountId,
        afterPublishedAt,
        afterGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite account timeline exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreFeedCardV1[] = rawRows
      .slice(0, request.value.limit)
      .map(feedCardFromSqliteRow);
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last?.publishedAt !== null && last !== undefined
          ? encodeLibraryCoreAccountTimelineCursorV1({
              accountDigest,
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              sortAt: last.publishedAt,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "account_timeline_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: [request.value.accountId],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "account timeline total count",
      ),
    };
    const parsed = parseLibraryCoreAccountTimelineResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryPersonTimeline(
    input: LibraryCorePersonTimelineRequestV1,
  ): LibraryCorePersonTimelineResponseV1 {
    const request = parseLibraryCorePersonTimelineRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const personDigest = libraryCorePersonTimelinePersonDigestV1(
      request.value.personId,
    );
    let afterPublishedAt: number | null = null;
    let afterGlobalId = "";
    if (request.value.cursor !== null) {
      const cursor = decodeLibraryCorePersonTimelineCursorV1(
        request.value.cursor,
      );
      if (!cursor.ok) throw new TypeError(cursor.error);
      if (
        cursor.value.personDigest !== personDigest ||
        cursor.value.generationId !== generationId ||
        cursor.value.transitionSequence !== sourceRevision ||
        cursor.value.projectionRevision !== sourceRevision
      ) {
        throw new Error("PWA Library SQLite person timeline cursor is stale");
      }
      afterPublishedAt = cursor.value.sortAt;
      afterGlobalId = cursor.value.globalId;
    }
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.person_timeline_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [
        request.value.personId,
        afterPublishedAt,
        afterGlobalId,
        request.value.limit + 1,
      ],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite person timeline exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreFeedCardV1[] = rawRows
      .slice(0, request.value.limit)
      .map(feedCardFromSqliteRow);
    const last = rows.at(-1);
    const response = {
      nextCursor:
        hasMore && last?.publishedAt !== null && last !== undefined
          ? encodeLibraryCorePersonTimelineCursorV1({
              generationId: generationId as never,
              globalId: last.globalId,
              projectionRevision: sourceRevision,
              sortAt: last.publishedAt,
              personDigest,
              transitionSequence: sourceRevision,
            })
          : null,
      queryId: "person_timeline_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
      totalCount: safeInteger(
        this.#database.exec({
          sql: program.countSql,
          bind: [request.value.personId],
          rowMode: 0,
          returnValue: "resultRows",
        })[0],
        "person timeline total count",
      ),
    };
    const parsed = parseLibraryCorePersonTimelineResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryMapMarkers(
    input: LibraryCoreMapMarkersRequestV1,
  ): LibraryCoreMapMarkersResponseV1 {
    const request = parseLibraryCoreMapMarkersRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.map_markers_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error("PWA Library SQLite map query exceeded its row bound");
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreMapMarkerV1[] = rawRows
      .slice(0, request.value.limit)
      .map((row) => ({
        authorAvatarUrl: nullableText(row.authorAvatarUrl, "map author avatar"),
        authorDisplayName: text(
          row.authorDisplayName,
          "map author display name",
        ),
        authorHandle: text(row.authorHandle, "map author handle"),
        authorId: text(row.authorId, "map author identity"),
        capturedAt: safeInteger(row.capturedAt, "map captured time"),
        contentText: nullableText(row.contentText, "map content text"),
        contentType: text(row.contentType, "map content type") as never,
        friendAvatarUrl: nullableText(row.friendAvatarUrl, "map Friend avatar"),
        friendName: nullableText(row.friendName, "map Friend name"),
        friendPersonId: nullableText(row.friendPersonId, "map Friend identity"),
        friendRelationshipStatus: nullableText(
          row.friendRelationshipStatus,
          "map Friend relationship",
        ) as never,
        globalId: text(row.globalId, "map item identity"),
        linkedAccountId: nullableText(
          row.linkedAccountId,
          "map linked Account identity",
        ),
        locationLat: row.locationLat === null ? null : Number(row.locationLat),
        locationLng: row.locationLng === null ? null : Number(row.locationLng),
        locationName: nullableText(row.locationName, "map location name"),
        locationUrl: nullableText(row.locationUrl, "map location URL"),
        platform: text(row.platform, "map platform") as never,
        publishedAt: safeInteger(row.publishedAt, "map published time"),
        sourceUrl: nullableText(row.sourceUrl, "map source URL"),
        timeRangeEndsAt: nullableInteger(row.timeRangeEndsAt, "map range end"),
        timeRangeStartsAt: nullableInteger(
          row.timeRangeStartsAt,
          "map range start",
        ),
      }));
    const response = {
      hasMore,
      queryId: "map_markers_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreMapMarkersResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #queryStoryWallCandidates(
    input: LibraryCoreStoryWallCandidatesRequestV1,
  ): LibraryCoreStoryWallCandidatesResponseV1 {
    const request = parseLibraryCoreStoryWallCandidatesRequestV1(input);
    if (!request.ok) throw new TypeError(request.error);
    const { generationId, sourceRevision } = this.#querySource();
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.story_wall_candidates_v1;
    const rawRows = this.#database.exec({
      sql: program.sql,
      bind: [request.value.limit + 1],
      rowMode: "object",
      returnValue: "resultRows",
    });
    if (rawRows.length > program.maximumScanRows) {
      throw new Error(
        "PWA Library SQLite Story Wall query exceeded its row bound",
      );
    }
    const hasMore = rawRows.length > request.value.limit;
    const rows: LibraryCoreStoryWallCandidateV1[] = rawRows
      .slice(0, request.value.limit)
      .map((row) => ({
        authorDisplayName: text(
          row.authorDisplayName,
          "Story Wall author display name",
        ),
        authorHandle: text(row.authorHandle, "Story Wall author handle"),
        authorId: text(row.authorId, "Story Wall author identity"),
        capturedAt: safeInteger(row.capturedAt, "Story Wall captured time"),
        contentText: nullableText(row.contentText, "Story Wall caption"),
        globalId: text(row.globalId, "Story Wall item identity"),
        linkedAccountId: nullableText(
          row.linkedAccountId,
          "Story Wall linked Account identity",
        ),
        linkedPersonId: nullableText(
          row.linkedPersonId,
          "Story Wall linked Person identity",
        ),
        locationName: nullableText(row.locationName, "Story Wall location"),
        mediaTypes: stringArray(
          row.mediaTypesJson,
          "Story Wall media types",
        ) as never,
        mediaUrls: stringArray(row.mediaUrlsJson, "Story Wall media URLs"),
        platform: text(row.platform, "Story Wall platform") as never,
        publishedAt: safeInteger(row.publishedAt, "Story Wall published time"),
        sourceUrl: nullableText(row.sourceUrl, "Story Wall source URL"),
      }));
    const response = {
      hasMore,
      queryId: "story_wall_candidates_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: sourceRevision,
        transitionSequence: sourceRevision,
      },
    };
    const parsed = parseLibraryCoreStoryWallCandidatesResponseV1(
      response,
      request.value,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  #checkpointStageStatus(
    stageId: string,
  ): LibraryCoreNormalizedCheckpointStageStatusV2 {
    const rows = this.#database.exec({
      sql: `SELECT expected_record_count, staged_record_count, staged_canonical_bytes
            FROM library_checkpoint_stages WHERE stage_id = ?1;`,
      bind: [stageId],
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1)
      throw new Error("normalized checkpoint stage does not exist");
    const expectedRecordCount = safeInteger(
      rows[0]?.[0],
      "checkpoint expected record count",
    );
    const stagedRecordCount = safeInteger(
      rows[0]?.[1],
      "checkpoint staged record count",
    );
    return Object.freeze({
      complete: expectedRecordCount === stagedRecordCount,
      expectedRecordCount,
      stagedCanonicalBytes: safeInteger(
        rows[0]?.[2],
        "checkpoint staged canonical bytes",
      ),
      stagedRecordCount,
      stageId,
    });
  }

  #verifyCheckpointContent(): void {
    const descriptors = this.#database.prepare(
      `SELECT content_digest, byte_length, storage_layout, chunk_count,
              range_count, range_index_root_digest
       FROM library_blobs ORDER BY content_digest;`,
    );
    try {
      while (descriptors.step()) {
        const contentDigest = text(
          descriptors.get(0),
          "checkpoint content digest",
        );
        const expectedBytes = safeInteger(
          descriptors.get(1),
          "checkpoint content byte length",
        );
        const storageLayout = text(
          descriptors.get(2),
          "checkpoint content storage layout",
        );
        const expectedChunks = safeInteger(
          descriptors.get(3),
          "checkpoint content chunk count",
        );
        const expectedRanges = safeInteger(
          descriptors.get(4),
          "checkpoint content range count",
        );
        const rangeIndexRoot = nullableText(
          descriptors.get(5),
          "checkpoint content range root",
        );
        if (storageLayout === "authenticated_ranges") {
          const unexpectedChunks = safeInteger(
            this.#database.exec({
              sql: "SELECT count(*) FROM library_blob_chunks WHERE content_digest = ?1;",
              bind: [contentDigest],
              rowMode: 0,
              returnValue: "resultRows",
            })[0],
            "ranged content inline chunk count",
          );
          if (unexpectedChunks !== 0) {
            throw new Error("ranged content contains inline chunks");
          }
          const root = new LibraryCoreSha256();
          root.update(contentRangeMapDigestPrefix);
          root.update(textEncoder.encode(contentDigest));
          root.update(lengthBytes(expectedBytes));
          root.update(lengthBytes(expectedRanges));
          const ranges = this.#database.prepare(
            `SELECT range_index, byte_offset, byte_length, range_digest
             FROM library_content_ranges
             WHERE content_digest = ?1 ORDER BY range_index;`,
          );
          let rangeIndex = 0;
          let byteOffset = 0;
          try {
            ranges.bind([contentDigest]);
            while (ranges.step()) {
              const rowIndex = safeInteger(
                ranges.get(0),
                "checkpoint content range index",
              );
              const rowOffset = safeInteger(
                ranges.get(1),
                "checkpoint content range offset",
              );
              const rowLength = safeInteger(
                ranges.get(2),
                "checkpoint content range length",
              );
              const rangeDigest = text(
                ranges.get(3),
                "checkpoint content range digest",
              );
              if (
                rowIndex !== rangeIndex ||
                rowOffset !== byteOffset ||
                rowLength < 1
              ) {
                throw new Error("checkpoint content ranges are not contiguous");
              }
              root.update(lengthBytes(rowIndex));
              root.update(lengthBytes(rowOffset));
              root.update(lengthBytes(rowLength));
              root.update(textEncoder.encode(rangeDigest));
              byteOffset += rowLength;
              if (!Number.isSafeInteger(byteOffset)) {
                throw new Error("checkpoint content range length overflowed");
              }
              rangeIndex += 1;
            }
          } finally {
            ranges.finalize();
          }
          if (
            rangeIndex !== expectedRanges ||
            byteOffset !== expectedBytes ||
            root.digestLowerHex() !== rangeIndexRoot
          ) {
            throw new Error("checkpoint content range map is incomplete");
          }
          continue;
        }
        if (storageLayout !== "inline_chunks" || expectedRanges !== 0) {
          throw new Error("checkpoint content layout is invalid");
        }
        const unexpectedRanges = safeInteger(
          this.#database.exec({
            sql: "SELECT count(*) FROM library_content_ranges WHERE content_digest = ?1;",
            bind: [contentDigest],
            rowMode: 0,
            returnValue: "resultRows",
          })[0],
          "inline content range count",
        );
        if (unexpectedRanges !== 0) {
          throw new Error("inline content contains range records");
        }
        const contentHash = createLibraryCoreMediaBlobDigestStateV1();
        const chunks = this.#database.prepare(
          `SELECT chunk_index, chunk_digest, bytes FROM library_blob_chunks
           WHERE content_digest = ?1 ORDER BY chunk_index;`,
        );
        let byteLength = 0;
        let chunkIndex = 0;
        try {
          chunks.bind([contentDigest]);
          while (chunks.step()) {
            if (
              safeInteger(chunks.get(0), "checkpoint content chunk index") !==
              chunkIndex
            ) {
              throw new Error("checkpoint content chunks are not contiguous");
            }
            const bytes = Uint8Array.from(
              chunks.getBlob(2) ??
                (() => {
                  throw new Error("checkpoint content chunk bytes are missing");
                })(),
            );
            if (
              text(chunks.get(1), "checkpoint content chunk digest") !==
              digestLibraryCoreMediaBlobBytesV1(bytes)
            ) {
              throw new Error("checkpoint content chunk digest is invalid");
            }
            byteLength += bytes.byteLength;
            if (!Number.isSafeInteger(byteLength)) {
              throw new Error("checkpoint content byte length overflowed");
            }
            contentHash.update(bytes);
            chunkIndex += 1;
          }
        } finally {
          chunks.finalize();
        }
        if (
          chunkIndex !== expectedChunks ||
          byteLength !== expectedBytes ||
          contentHash.digestLowerHex() !== contentDigest
        ) {
          throw new Error("checkpoint content descriptor is incomplete");
        }
      }
    } finally {
      descriptors.finalize();
    }
  }

  #verifyCheckpointAuthority(libraryId: string, authorityEpoch: string): void {
    const matches = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*)
              FROM library_active_authority AS active
              JOIN library_authority_epochs AS epoch
                ON epoch.epoch_id = active.epoch_id
              WHERE active.active_key = 'active'
                AND active.library_id = ?1
                AND active.epoch_id = ?2
                AND epoch.library_id = active.library_id
                AND epoch.accepted_manifest_generation = active.accepted_manifest_generation;`,
        bind: [libraryId, authorityEpoch],
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "checkpoint active authority",
    );
    if (matches !== 1) {
      throw new Error("checkpoint active authority does not match its header");
    }
    const actorWithoutCapability = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*)
              FROM library_actors AS actor
              WHERE actor.retired_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM library_actor_capabilities AS capability
                  WHERE capability.actor_id = actor.actor_id
                    AND capability.retired_at IS NULL
                );`,
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "checkpoint actors without capabilities",
    );
    if (actorWithoutCapability !== 0) {
      throw new Error(
        "checkpoint active actor does not have an active capability",
      );
    }
    const retirementStateMismatch = safeInteger(
      this.#database.exec({
        sql: `SELECT count(*)
              FROM library_actors AS actor
              JOIN library_actor_capabilities AS capability
                ON capability.actor_id = actor.actor_id
              LEFT JOIN library_actor_retirements AS retirement
                ON retirement.actor_id = actor.actor_id
               AND retirement.capability_id = capability.capability_id
              WHERE (actor.retired_at IS NULL) <> (capability.retired_at IS NULL)
                 OR (actor.retired_at IS NULL) <> (retirement.actor_id IS NULL)
                 OR (actor.retired_at IS NOT NULL AND (
                      actor.retired_at IS NOT capability.retired_at
                   OR capability.retirement_certificate_digest IS NOT retirement.certificate_digest
                   OR capability.retirement_identity IS NOT retirement.retirement_identity
                   OR capability.certificate_digest IS NOT retirement.capability_certificate_digest
                   OR actor.authority_epoch_id IS NOT retirement.authority_epoch_id
                   OR retirement.committed_revision < 1
                   OR retirement.committed_revision > (SELECT source_revision FROM library_meta WHERE singleton_id = 1)
                 ));`,
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "checkpoint actor retirement consistency",
    );
    if (retirementStateMismatch !== 0) {
      throw new Error("checkpoint actor retirement state is inconsistent");
    }
    const knownMutations = new Set<string>(LIBRARY_CORE_OPERATION_IDS);
    const mutations = this.#database.exec({
      sql: `SELECT DISTINCT mutation_id
            FROM library_actor_capability_mutations
            ORDER BY mutation_id;`,
      rowMode: 0,
      returnValue: "resultRows",
    });
    for (const mutation of mutations) {
      if (!knownMutations.has(text(mutation, "capability mutation"))) {
        throw new Error(
          "checkpoint actor capability names an unknown mutation",
        );
      }
    }
    const knownAgentQueries = new Set<string>(LIBRARY_CORE_AGENT_QUERY_IDS);
    const capabilityQueries = this.#database.exec({
      sql: `SELECT DISTINCT query_id
            FROM library_actor_capability_queries
            ORDER BY query_id;`,
      rowMode: 0,
      returnValue: "resultRows",
    });
    for (const queryId of capabilityQueries) {
      if (!knownAgentQueries.has(text(queryId, "capability query"))) {
        throw new Error("checkpoint actor capability names an unknown query");
      }
    }
  }

  close(): void {
    this.#database.close();
  }

  #verifyStorageIdentity(): void {
    const rows = this.#database.exec({
      sql: `SELECT contract_version, schema_version, protocol_version, schema_sha256
            FROM library_storage_meta WHERE singleton_id = 1;`,
      rowMode: "array",
      returnValue: "resultRows",
    });
    if (rows.length !== 1) {
      throw new Error("PWA Library SQLite storage identity is missing");
    }
    const applicationId = safeInteger(
      this.#database.exec({
        sql: "PRAGMA application_id;",
        rowMode: 0,
        returnValue: "resultRows",
      })[0],
      "SQLite application identity",
    );
    const row = rows[0]!;
    if (
      applicationId !== LIBRARY_CORE_SQLITE_APPLICATION_ID ||
      safeInteger(row[0], "SQLite contract version") !==
        LIBRARY_CORE_SQLITE_CONTRACT_VERSION ||
      safeInteger(row[1], "SQLite schema version") !==
        LIBRARY_CORE_SQLITE_SCHEMA_VERSION ||
      safeInteger(row[2], "SQLite protocol version") !==
        LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
      text(row[3], "SQLite schema digest") !==
        LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256
    ) {
      throw new Error(
        "PWA Library SQLite storage identity does not match this build",
      );
    }
  }
}
