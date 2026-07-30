import { invoke } from "@tauri-apps/api/core";
import type {
  LibraryCoreProjectionBatchV1,
  LibraryCoreProjectionSourceV1,
  WorkerResponse,
} from "./automerge-types";

export type LibraryCoreProjectionStartedV1 = Extract<
  WorkerResponse,
  { type: "LIBRARY_CORE_PROJECTION_STARTED" }
>;

export interface LibraryCoreShadowProjectionStatus {
  sourceKey: string;
  selected: boolean;
  complete: boolean;
  nextBatchIndex: number;
  projectedRows: number;
  totalRows: number;
  generationId: string | null;
  transitionSequence: number | null;
}

export interface LibraryCoreProjectionWorkerClient {
  begin(sessionId: string): Promise<LibraryCoreProjectionStartedV1>;
  nextBatch(sessionId: string, batchIndex: number): Promise<LibraryCoreProjectionBatchV1>;
  cancel(sessionId: string): Promise<void>;
}

export interface LibraryCoreShadowNativeClient {
  begin(input: {
    sessionId: string;
    source: LibraryCoreProjectionSourceV1;
    totalRows: number;
  }): Promise<LibraryCoreShadowProjectionStatus>;
  apply(batch: LibraryCoreProjectionBatchV1): Promise<LibraryCoreShadowProjectionStatus>;
  finalize(sessionId: string): Promise<LibraryCoreShadowProjectionStatus>;
}

export const tauriLibraryCoreShadowNativeClient: LibraryCoreShadowNativeClient = {
  begin(input) {
    return invoke<LibraryCoreShadowProjectionStatus>(
      "begin_library_core_shadow_projection",
      input,
    );
  },
  apply(batch) {
    return invoke<LibraryCoreShadowProjectionStatus>(
      "apply_library_core_shadow_projection_batch",
      { batch },
    );
  },
  finalize(sessionId) {
    return invoke<LibraryCoreShadowProjectionStatus>(
      "finalize_library_core_shadow_projection",
      { sessionId },
    );
  },
};

/**
 * Copies one exact worker-pinned Automerge revision into a replayable SQLite
 * generation. Earlier worker batches are deliberately replayed after a native
 * restart. The native receipts make those retries idempotent and let one fresh
 * worker catch up to the durable staging cursor without an unbounded snapshot.
 */
export async function projectLibraryCoreShadow(
  workerClient: LibraryCoreProjectionWorkerClient,
  nativeClient: LibraryCoreShadowNativeClient,
  sessionId: string,
): Promise<LibraryCoreShadowProjectionStatus> {
  let failure: unknown;
  let result: LibraryCoreShadowProjectionStatus | undefined;
  try {
    const started = await workerClient.begin(sessionId);
    const native = await nativeClient.begin({
      sessionId,
      source: started.source,
      totalRows: started.totalRows,
    });
    if (native.selected) {
      result = native;
    } else if (native.complete) {
      result = await nativeClient.finalize(sessionId);
    } else {
      let batchIndex = started.nextBatchIndex;
      while (!result) {
        const batch = await workerClient.nextBatch(sessionId, batchIndex);
        const applied = await nativeClient.apply(batch);
        if (batch.done) {
          if (!applied.complete) {
            throw new Error("SQLite shadow did not commit the terminal worker batch");
          }
          result = await nativeClient.finalize(sessionId);
        } else {
          batchIndex += 1;
        }
      }
    }
  } catch (error) {
    failure = error;
  }

  try {
    await workerClient.cancel(sessionId);
  } catch (error) {
    if (failure === undefined) failure = error;
  }

  if (failure !== undefined) throw failure;
  if (!result) throw new Error("SQLite shadow projection did not produce a result");
  return result;
}
