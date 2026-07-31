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
  LIBRARY_CORE_CHECKPOINT_PAGE_RECORD_LIMIT,
  LIBRARY_CORE_CHECKPOINT_RECORD_BYTE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_RECORD_LIMIT,
  importLibraryCoreCheckpointPagesV1,
  type ImportLibraryCoreCheckpointPagesRequestV1,
  type ImportLibraryCoreCheckpointPagesResultV1,
  type LibraryCoreCheckpointPageReferenceV1,
} from "./library-core-checkpoint-import.js";
export {
  LIBRARY_CORE_GOOGLE_DRIVE_SIMPLE_UPLOAD_LIMIT,
  createGoogleDriveLibraryCoreAdapterV1,
  discoverGoogleDriveLibraryCoreControlV1,
  type GoogleDriveLibraryCoreAdapterOptionsV1,
  type GoogleDriveLibraryCoreControlLocatorV1,
} from "./library-core-google-drive-adapter.js";
export {
  LIBRARY_CORE_STORED_WIRE_OBJECT_BYTE_CEILING,
  decodeLibraryCoreWireObjectV1,
  encodeLibraryCoreWireObjectV1,
} from "./library-core-wire-object.js";
