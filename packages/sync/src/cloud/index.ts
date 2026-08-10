/**
 * @freed/sync/cloud — cloud file sync primitives
 *
 * Provides Google Drive and Dropbox sync adapters. Both adapters store a
 * single `freed.automerge` binary in an app-scoped folder and implement a
 * download → CRDT-merge → upload cycle with optimistic locking so
 * concurrent writes from desktop + phone always converge.
 *
 * These modules are browser-compatible (fetch-based, no Node.js deps) and
 * can be imported from both the PWA and the desktop Tauri webview.
 */

export type { CloudProvider } from "./types.js";
export {
  gdriveUploadSafe,
  gdriveUploadReplace,
  gdriveDownloadLatest,
  gdriveStartPollLoop,
  gdriveDeleteFile,
  type GoogleDriveFetch,
  type CloudUploadResult,
} from "./gdrive.js";
export {
  dropboxUploadSafe,
  dropboxUploadReplace,
  dropboxDownloadLatest,
  dropboxStartLongpollLoop,
  dropboxDeleteFile,
} from "./dropbox.js";
export { mergeBinaries, delay } from "./merge.js";
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
  LIBRARY_CORE_GOOGLE_DRIVE_SIMPLE_UPLOAD_LIMIT,
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreIntentAdapterV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverGoogleDriveLibraryCoreControlV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverPublishedGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreControlV1,
  provisionGoogleDriveLibraryCoreIntentHeadV1,
  type GoogleDriveLibraryCoreAdapterOptionsV1,
  type GoogleDriveLibraryCoreControlLocatorV1,
  type GoogleDriveLibraryCoreIntentAdapterOptionsV1,
  type GoogleDriveLibraryCoreIntentHeadLocatorV1,
  type DiscoveredGoogleDriveLibraryCoreActorEnrollmentRequestV1,
  type DiscoveredGoogleDriveLibraryCoreActorEnrollmentV1,
  type DiscoveredGoogleDriveLibraryCoreIntentSegmentV1,
  type PublishedGoogleDriveLibraryCoreControlV1,
  type ProvisionedGoogleDriveLibraryCoreControlV1,
  type ProvisionedGoogleDriveLibraryCoreIntentHeadV1,
} from "./library-core-google-drive-adapter.js";
export {
  LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING,
  decodeLibraryCoreWireObjectV1,
  encodeLibraryCoreWireObjectV1,
} from "./library-core-wire-object.js";
