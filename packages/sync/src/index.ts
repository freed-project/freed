/**
 * @freed/sync - Cross-device sync for Freed
 */

export { FilesystemStorage } from "./storage/filesystem.js";
export {
  IndexedDBStorage,
  StaleStorageRevisionError,
} from "./storage/indexeddb.js";
export {
  RepeatableAutomergePersistence,
  StaleAutomergePersistenceStateError,
} from "./storage/repeatable-automerge-persistence.js";
export type {
  AutomergePersistenceOptions,
  CommittedAutomergePersistenceSnapshot,
  CommittedAutomergePersistenceState,
  LoadedAutomergePersistence,
} from "./storage/repeatable-automerge-persistence.js";
export { LocalRelay } from "./network/local-relay.js";
export type {
  SyncStatus,
  SyncConfig,
  RevisionedStorageAdapter,
  RevisionedStorageValue,
  StorageRevision,
  StorageAdapter,
  SyncStatusListener,
} from "./types.js";
