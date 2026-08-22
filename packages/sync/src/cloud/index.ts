/** Browser-safe immutable Library Core synchronization primitives. */

export * from "./library-core.js";
export type {
  LibraryCoreMediaBlobAdapterV1,
  LibraryCoreMediaBlobSourceV1,
  LibraryCorePreparedMediaBlobV1,
} from "./library-core-media-blob.js";
export {
  publishLibraryCoreImmutableGenerationV1,
  reassignLibraryCoreWriterV1,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutablePublicationAdapterV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCoreImmutablePublicationRequestV1,
  type LibraryCoreImmutablePublicationResultV1,
  type LibraryCorePreparedImmutableObjectV1,
  type LibraryCorePublishedImmutableObjectReceiptV1,
  type LibraryCoreWriterReassignmentRequestV1,
} from "./library-core-immutable-publication.js";
export {
  LIBRARY_CORE_CHECKPOINT_PAGE_DECODED_BYTE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_PAGE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_BYTE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_PAGE_RECORD_LIMIT,
  LIBRARY_CORE_CHECKPOINT_RECORD_BYTE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_RECORD_LIMIT,
  importLibraryCoreCheckpointManifestV1,
  importLibraryCoreCheckpointPagesV1,
  type ImportLibraryCoreCheckpointManifestRequestV1,
  type ImportLibraryCoreCheckpointManifestResultV1,
  type ImportLibraryCoreCheckpointPagesRequestV1,
  type ImportLibraryCoreCheckpointPagesResultV1,
  type LibraryCoreCheckpointPageReferenceV1,
} from "./library-core-checkpoint-import.js";
export {
  LIBRARY_CORE_CHECKPOINT_PUBLICATION_PAGE_LIMIT,
  publishLibraryCoreCheckpointGenerationV1,
  reassignLibraryCoreCheckpointGenerationV1,
  type LibraryCorePreparedCheckpointPageV1,
  type PublishLibraryCoreCheckpointGenerationRequestV1,
  type ReassignLibraryCoreCheckpointGenerationRequestV1,
} from "./library-core-checkpoint-publication.js";
export {
  importLibraryCorePortableCheckpointV1,
  prepareLibraryCorePortableCheckpointPagesV1,
  publishLibraryCorePortableCheckpointV1,
  reassignLibraryCorePortableCheckpointV1,
  type ImportLibraryCorePortableCheckpointRequestV1,
  type ImportLibraryCorePortableCheckpointResultV1,
  type LibraryCorePortableCheckpointImportWriterV1,
  type LibraryCorePortableCheckpointStagingReceiptV1,
  type PrepareLibraryCorePortableCheckpointPagesRequestV1,
  type PublishLibraryCorePortableCheckpointRequestV1,
  type ReassignLibraryCorePortableCheckpointRequestV1,
} from "./library-core-portable-checkpoint.js";
export {
  importLibraryCoreNormalizedCheckpointV2,
  prepareLibraryCoreNormalizedCheckpointPagesV2,
  publishLibraryCoreNormalizedCheckpointV2,
  reassignLibraryCoreNormalizedCheckpointV2,
  type PrepareLibraryCoreNormalizedCheckpointPagesRequestV2,
  type ImportLibraryCoreNormalizedCheckpointRequestV2,
  type ImportLibraryCoreNormalizedCheckpointResultV2,
  type LibraryCoreNormalizedCheckpointImportWriterV2,
  type PublishLibraryCoreNormalizedCheckpointRequestV2,
  type ReassignLibraryCoreNormalizedCheckpointRequestV2,
} from "./library-core-normalized-checkpoint.js";
export {
  importLibraryCoreIntentSegmentV1,
  prepareLibraryCoreIntentSegmentV1,
  type ImportLibraryCoreIntentSegmentRequestV1,
  type LibraryCoreIntentOutboxEntryV1,
  type LibraryCoreIntentSegmentImportReceiptV1,
  type LibraryCoreIntentSegmentImportWriterV1,
  type PreparedLibraryCoreIntentSegmentV1,
  type PrepareLibraryCoreIntentSegmentRequestV1,
} from "./library-core-intent-segments.js";
export {
  publishLibraryCoreIntentCandidateV1,
  type LibraryCoreIntentHeadCompareAndSwapResultV1,
  type LibraryCoreIntentHeadReadV1,
  type LibraryCoreIntentPublicationAdapterV1,
  type LibraryCoreIntentPublicationCandidateV1,
  type LibraryCoreIntentPublicationResultV1,
} from "./library-core-intent-publication.js";
export {
  importLibraryCoreResultSegmentV1,
  prepareLibraryCoreResultSegmentV1,
  type LibraryCoreResultOutboxEntryV1,
} from "./library-core-result-segments.js";
export {
  importLibraryCoreNormalizedResultSegmentV2,
  prepareLibraryCoreNormalizedResultSegmentV2,
  type LibraryCoreNormalizedResultSegmentImportWriterV2,
  type PreparedLibraryCoreNormalizedResultSegmentV2,
} from "./library-core-normalized-result-segments.js";
export {
  publishLibraryCoreResultEntriesV1,
  type LibraryCoreResultHeadReadV1,
  type LibraryCoreResultPublicationAdapterV1,
} from "./library-core-result-publication.js";
export {
  importLibraryCoreOperationSegmentV1,
  prepareLibraryCoreOperationSegmentV1,
  type ImportLibraryCoreOperationSegmentRequestV1,
  type LibraryCoreOperationOutboxEntryV1,
  type LibraryCoreOperationSegmentImportReceiptV1,
  type LibraryCoreOperationSegmentImportWriterV1,
  type PreparedLibraryCoreOperationSegmentV1,
  type PrepareLibraryCoreOperationSegmentRequestV1,
} from "./library-core-operation-segments.js";
export {
  LIBRARY_CORE_GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES,
  LIBRARY_CORE_GOOGLE_DRIVE_SIMPLE_UPLOAD_LIMIT,
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreIntentAdapterV1,
  createGoogleDriveLibraryCoreMediaBlobAdapterV1,
  createGoogleDriveLibraryCoreResultAdapterV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverGoogleDriveLibraryCoreControlV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverGoogleDriveLibraryCoreResultHeadV1,
  discoverGoogleDriveLibraryCoreResultSegmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreIntentHeadV1,
  provisionGoogleDriveLibraryCoreResultHeadV1,
  type GoogleDriveLibraryCoreAdapterOptionsV1,
  type GoogleDriveLibraryCoreControlLocatorV1,
  type GoogleDriveLibraryCoreIntentAdapterOptionsV1,
  type GoogleDriveLibraryCoreIntentHeadLocatorV1,
  type GoogleDriveLibraryCoreMediaBlobAdapterOptionsV1,
  type DiscoveredGoogleDriveLibraryCoreActorEnrollmentRequestV1,
  type DiscoveredGoogleDriveLibraryCoreActorEnrollmentV1,
  type DiscoveredGoogleDriveLibraryCoreIntentSegmentV1,
  type DiscoveredGoogleDriveLibraryCoreResultSegmentV1,
  type GoogleDriveLibraryCoreResultAdapterOptionsV1,
  type GoogleDriveLibraryCoreResultHeadLocatorV1,
  type PublishedGoogleDriveLibraryCoreControlV1,
  type ProvisionedGoogleDriveLibraryCoreControlV1,
  type ProvisionedGoogleDriveLibraryCoreIntentHeadV1,
  type ProvisionedGoogleDriveLibraryCoreResultHeadV1,
} from "./library-core-google-drive-adapter.js";
export {
  LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING,
  decodeLibraryCoreWireObjectV1,
  encodeLibraryCoreWireObjectV1,
} from "./library-core-wire-object.js";
