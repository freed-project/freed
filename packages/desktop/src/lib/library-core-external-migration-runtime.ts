import { invoke } from "@tauri-apps/api/core";
import type { WorkerResponse } from "./automerge-types";
import type { LibraryCoreShadowProjectionStatus } from "./library-core-shadow-runtime";

export type LibraryCoreExternalExportStartedV1 = Extract<
  WorkerResponse,
  { type: "LIBRARY_CORE_EXTERNAL_EXPORT_STARTED" }
>;
export type LibraryCoreExternalExportChunkV1 = Extract<
  WorkerResponse,
  { type: "LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK" }
>;
export type LibraryCoreExternalExportConfirmedV1 = Extract<
  WorkerResponse,
  { type: "LIBRARY_CORE_EXTERNAL_EXPORT_CONFIRMED" }
>;

export interface LibraryCoreExternalExportWorkerClient {
  begin(sessionId: string): Promise<LibraryCoreExternalExportStartedV1>;
  read(sessionId: string, offset: number): Promise<LibraryCoreExternalExportChunkV1>;
  confirm(sessionId: string): Promise<LibraryCoreExternalExportConfirmedV1>;
  cancel(sessionId: string): Promise<void>;
}

export interface LibraryCoreExternalMigrationNativeClient {
  begin(input: {
    sessionId: string;
    source: LibraryCoreExternalExportStartedV1["source"];
  }): Promise<LibraryCoreExternalMigrationSpoolStatus>;
  append(input: {
    sessionId: string;
    offset: number;
    bytes: Uint8Array;
  }): Promise<LibraryCoreExternalMigrationSpoolStatus>;
  finalize(sessionId: string): Promise<LibraryCoreShadowProjectionStatus>;
  complete(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}

export interface LibraryCoreExternalMigrationSpoolStatus {
  sessionId: string;
  committedOffset: number;
  byteLength: number;
  complete: boolean;
}

export interface LibraryCoreExternalMigrationResult {
  migrated: boolean;
  projection: LibraryCoreShadowProjectionStatus | null;
}

export const tauriLibraryCoreExternalMigrationNativeClient:
  LibraryCoreExternalMigrationNativeClient = {
    begin(input) {
      const { generation, saveRevision } = input.source.storageRevision;
      return invoke<LibraryCoreExternalMigrationSpoolStatus>(
        "begin_library_core_external_migration",
        {
          sessionId: input.sessionId,
          source: {
            schemaVersion: input.source.schemaVersion,
            storageGeneration: generation,
            storageSaveRevision: saveRevision,
            byteLength: input.source.byteLength,
          },
        },
      );
    },
    append(input) {
      return invoke<LibraryCoreExternalMigrationSpoolStatus>(
        "append_library_core_external_migration_chunk",
        {
          sessionId: input.sessionId,
          offset: input.offset,
          // Tauri's JSON command boundary needs an ordinary dense array. The
          // worker caps this transient copy at exactly one 1 MiB chunk.
          bytes: Array.from(input.bytes),
        },
      );
    },
    finalize(sessionId) {
      return invoke<LibraryCoreShadowProjectionStatus>(
        "finalize_library_core_external_migration",
        { sessionId },
      );
    },
    complete(sessionId) {
      return invoke<void>("complete_library_core_external_migration", {
        sessionId,
      });
    },
    cancel(sessionId) {
      return invoke<void>("cancel_library_core_external_migration", {
        sessionId,
      });
    },
  };

function sameSource(
  left: LibraryCoreExternalExportStartedV1["source"],
  right: LibraryCoreExternalExportStartedV1["source"],
): boolean {
  return (
    left.schemaVersion === right.schemaVersion
    && left.byteLength === right.byteLength
    && left.storageRevision.generation === right.storageRevision.generation
    && left.storageRevision.saveRevision === right.storageRevision.saveRevision
  );
}

function validateOffset(value: number, byteLength: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > byteLength) {
    throw new Error("Library Core external migration returned an invalid offset");
  }
}

function nativeMigrationSessionId(
  source: LibraryCoreExternalExportStartedV1["source"],
): string {
  const { generation, saveRevision } = source.storageRevision;
  for (const value of [generation, saveRevision, source.byteLength]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Library Core external export source revision is invalid");
    }
  }
  // The legacy IndexedDB bridge advances generation and saveRevision in the
  // same transaction that commits the exact bytes. Reusing this bounded
  // identity lets a new renderer generation reopen the native spool after a
  // crash instead of copying the source from byte zero under a random UUID.
  return `legacy-v1:${generation}:${saveRevision}:${source.byteLength}`;
}

/**
 * Streams the exact pre-Automerge durable snapshot into native bounded storage,
 * builds and selects one immutable SQLite projection, then releases the worker
 * source clone. An empty first-run database has no migration candidate.
 */
export async function migrateLibraryCoreExternalSnapshot(
  workerClient: LibraryCoreExternalExportWorkerClient,
  nativeClient: LibraryCoreExternalMigrationNativeClient,
  sessionId: string,
): Promise<LibraryCoreExternalMigrationResult> {
  const started = await workerClient.begin(sessionId);
  if (started.source.byteLength === 0) {
    await workerClient.cancel(sessionId);
    return { migrated: false, projection: null };
  }
  if (
    started.maximumChunkBytes !== 1_048_576
    || !Number.isSafeInteger(started.source.byteLength)
    || started.source.byteLength < 0
  ) {
    await workerClient.cancel(sessionId);
    throw new Error("Library Core external export contract is invalid");
  }

  const nativeSessionId = nativeMigrationSessionId(started.source);
  let nativeActive = false;
  let failure: unknown;
  let projection: LibraryCoreShadowProjectionStatus | null = null;
  try {
    let native = await nativeClient.begin({
      sessionId: nativeSessionId,
      source: started.source,
    });
    nativeActive = true;
    if (
      native.sessionId !== nativeSessionId
      || native.byteLength !== started.source.byteLength
    ) {
      throw new Error("Library Core native migration source does not match the worker");
    }
    validateOffset(native.committedOffset, native.byteLength);

    while (!native.complete) {
      const chunk = await workerClient.read(sessionId, native.committedOffset);
      if (
        chunk.sessionId !== sessionId
        || !sameSource(chunk.source, started.source)
        || chunk.offset !== native.committedOffset
        || chunk.nextOffset !== chunk.offset + chunk.bytes.byteLength
        || chunk.done !== (chunk.nextOffset === started.source.byteLength)
      ) {
        throw new Error("Library Core external export chunk is inconsistent");
      }
      validateOffset(chunk.nextOffset, started.source.byteLength);
      native = await nativeClient.append({
        sessionId: nativeSessionId,
        offset: chunk.offset,
        bytes: chunk.bytes,
      });
      if (
        native.sessionId !== nativeSessionId
        || native.byteLength !== started.source.byteLength
        || native.committedOffset !== chunk.nextOffset
      ) {
        throw new Error("Library Core native migration receipt is inconsistent");
      }
    }

    projection = await nativeClient.finalize(nativeSessionId);
    nativeActive = false;
    if (!projection.selected || !projection.complete) {
      throw new Error("Library Core external migration did not select a complete generation");
    }
    const confirmed = await workerClient.confirm(sessionId);
    if (confirmed.sessionId !== sessionId || !sameSource(confirmed.source, started.source)) {
      throw new Error("Library Core worker confirmation changed the migration source");
    }
    // The spool is the response-loss recovery authority until both publication
    // and worker confirmation succeed. Only then may native cleanup remove this
    // revision's source, journal, and scratch graph.
    await nativeClient.complete(nativeSessionId);
  } catch (error) {
    failure = error;
  }

  if (nativeActive) {
    try {
      await nativeClient.cancel(nativeSessionId);
    } catch (error) {
      if (failure === undefined) failure = error;
    }
  }
  try {
    await workerClient.cancel(sessionId);
  } catch (error) {
    if (failure === undefined) failure = error;
  }

  if (failure !== undefined) throw failure;
  return { migrated: true, projection };
}
