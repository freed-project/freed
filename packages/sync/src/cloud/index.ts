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
export { gdriveUploadSafe, gdriveDownloadLatest, gdriveStartPollLoop, gdriveDeleteFile } from "./gdrive.js";
export {
  dropboxUploadSafe,
  dropboxDownloadLatest,
  dropboxStartLongpollLoop,
  dropboxDeleteFile,
} from "./dropbox.js";
export { mergeBinaries, delay } from "./merge.js";
