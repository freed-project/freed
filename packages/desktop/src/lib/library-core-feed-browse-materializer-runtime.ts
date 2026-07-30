import { invoke } from "@tauri-apps/api/core";
import type {
  LibraryCoreFeedBrowseFilterInputV1,
  LibraryCoreFeedBrowseFilterV1,
} from "@freed/shared/library-core";

import type {
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreFeedBrowseProjectionBatchV1,
  WorkerResponse,
} from "./automerge-types";

export type LibraryCoreFeedBrowseProjectionStartedV1 = Extract<
  WorkerResponse,
  { type: "LIBRARY_CORE_FEED_BROWSE_PROJECTION_STARTED" }
>;

export interface LibraryCoreFeedBrowseGenerationStatusV1 {
  readonly generationId: string;
  readonly nextBatchIndex: number;
  readonly writtenRows: number;
  readonly totalRows: number;
  readonly complete: boolean;
}

export interface LibraryCoreFeedBrowseProjectionWorkerClient {
  begin(
    sessionId: string,
    filter: LibraryCoreFeedBrowseFilterInputV1 | undefined,
    rankingClockMs: number,
  ): Promise<LibraryCoreFeedBrowseProjectionStartedV1>;
  nextBatch(
    sessionId: string,
    batchIndex: number,
  ): Promise<LibraryCoreFeedBrowseProjectionBatchV1>;
  cancel(sessionId: string): Promise<void>;
}

export interface LibraryCoreFeedBrowseNativeClient {
  begin(input: {
    sessionId: string;
    binding: LibraryCoreFeedBrowseGenerationBindingV1;
  }): Promise<LibraryCoreFeedBrowseGenerationStatusV1>;
  append(
    batch: LibraryCoreFeedBrowseProjectionBatchV1,
  ): Promise<LibraryCoreFeedBrowseGenerationStatusV1>;
  finalize(
    sessionId: string,
  ): Promise<LibraryCoreFeedBrowseGenerationStatusV1>;
  cancel(
    sessionId: string,
  ): Promise<LibraryCoreFeedBrowseGenerationStatusV1>;
}

export interface MaterializeDesktopLibraryCoreFeedBrowseGenerationResult {
  readonly binding: LibraryCoreFeedBrowseGenerationBindingV1;
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly status: LibraryCoreFeedBrowseGenerationStatusV1;
}

export const tauriLibraryCoreFeedBrowseNativeClient: LibraryCoreFeedBrowseNativeClient =
  {
  begin(input) {
    return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
      "begin_library_core_feed_browse_generation",
      input,
    );
  },
  append(batch) {
    return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
      "append_library_core_feed_browse_generation_page",
      {
        batch: {
          sessionId: batch.sessionId,
          batchIndex: batch.batchIndex,
          rows: batch.rows,
        },
      },
    );
  },
  finalize(sessionId) {
    return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
      "finalize_library_core_feed_browse_generation",
      { sessionId },
    );
  },
  cancel(sessionId) {
    return invoke<LibraryCoreFeedBrowseGenerationStatusV1>(
      "cancel_library_core_feed_browse_generation",
      { sessionId },
    );
  },
  };

function sameBinding(
  left: LibraryCoreFeedBrowseGenerationBindingV1,
  right: LibraryCoreFeedBrowseGenerationBindingV1,
): boolean {
  return (
    left.generationId === right.generationId &&
    left.sourceDocumentId === right.sourceDocumentId &&
    left.sourceHeadsDigest === right.sourceHeadsDigest &&
    left.sourceHeadCount === right.sourceHeadCount &&
    left.transitionSequence === right.transitionSequence &&
    left.projectionRevision === right.projectionRevision &&
    left.filterJson === right.filterJson &&
    left.rankingClockMs === right.rankingClockMs &&
    left.recommendationOrderSchemaVersion ===
      right.recommendationOrderSchemaVersion &&
    left.totalRows === right.totalRows
  );
}

function assertStatus(
  status: LibraryCoreFeedBrowseGenerationStatusV1,
  binding: LibraryCoreFeedBrowseGenerationBindingV1,
): void {
  if (
    status.generationId !== binding.generationId ||
    status.totalRows !== binding.totalRows ||
    !Number.isSafeInteger(status.nextBatchIndex) ||
    status.nextBatchIndex < 0 ||
    !Number.isSafeInteger(status.writtenRows) ||
    status.writtenRows < 0 ||
    status.writtenRows > binding.totalRows ||
    (status.complete && status.writtenRows !== binding.totalRows)
  ) {
    throw new Error("Native browse generation returned invalid progress");
  }
}

async function recoverAppendResponse(
  nativeClient: LibraryCoreFeedBrowseNativeClient,
  started: LibraryCoreFeedBrowseProjectionStartedV1,
  batch: LibraryCoreFeedBrowseProjectionBatchV1,
  failure: unknown,
): Promise<LibraryCoreFeedBrowseGenerationStatusV1> {
  let recovered: LibraryCoreFeedBrowseGenerationStatusV1;
  try {
    recovered = await nativeClient.begin({
      sessionId: started.sessionId,
      binding: started.binding,
    });
  } catch {
    throw failure;
  }
  assertStatus(recovered, started.binding);
  if (
    recovered.nextBatchIndex < batch.batchIndex + 1 ||
    recovered.writtenRows < batch.projectedRows
  ) {
    throw failure;
  }
  return recovered;
}

async function recoverFinalizeResponse(
  nativeClient: LibraryCoreFeedBrowseNativeClient,
  started: LibraryCoreFeedBrowseProjectionStartedV1,
  failure: unknown,
): Promise<LibraryCoreFeedBrowseGenerationStatusV1> {
  let recovered: LibraryCoreFeedBrowseGenerationStatusV1;
  try {
    recovered = await nativeClient.begin({
      sessionId: started.sessionId,
      binding: started.binding,
    });
  } catch {
    throw failure;
  }
  assertStatus(recovered, started.binding);
  if (!recovered.complete) throw failure;
  return recovered;
}

/**
 * Copy one worker-authenticated, normalized browse projection into the native
 * SQLite staging generation. The worker retains only one iterator and one
 * replayable 128-row page. Native receipts absorb exact page and finalization
 * response loss without widening product authority.
 */
export async function materializeDesktopLibraryCoreFeedBrowseGeneration(
  workerClient: LibraryCoreFeedBrowseProjectionWorkerClient,
  nativeClient: LibraryCoreFeedBrowseNativeClient,
  sessionId: string,
  filter: LibraryCoreFeedBrowseFilterInputV1 | undefined,
  rankingClockMs: number,
): Promise<MaterializeDesktopLibraryCoreFeedBrowseGenerationResult> {
  let failure: unknown;
  let nativeStarted = false;
  let started: LibraryCoreFeedBrowseProjectionStartedV1 | undefined;
  let status: LibraryCoreFeedBrowseGenerationStatusV1 | undefined;
  try {
    started = await workerClient.begin(sessionId, filter, rankingClockMs);
    status = await nativeClient.begin({
      sessionId,
      binding: started.binding,
    });
    nativeStarted = true;
    assertStatus(status, started.binding);

    if (!status.complete) {
      let batchIndex = 0;
      while (true) {
        const batch = await workerClient.nextBatch(sessionId, batchIndex);
        if (
          !sameBinding(batch.binding, started.binding) ||
          batch.sessionId !== sessionId ||
          batch.batchIndex !== batchIndex
        ) {
          throw new Error("Worker browse projection changed binding");
        }
        if (batch.rows.length > 0) {
          try {
            status = await nativeClient.append(batch);
            assertStatus(status, started.binding);
          } catch (error) {
            status = await recoverAppendResponse(
              nativeClient,
              started,
              batch,
              error,
            );
          }
        }
        if (batch.done) {
          if (
            batch.projectedRows !== started.binding.totalRows ||
            status.writtenRows !== started.binding.totalRows
          ) {
            throw new Error("Browse projection ended before every row committed");
          }
          try {
            status = await nativeClient.finalize(sessionId);
            assertStatus(status, started.binding);
          } catch (error) {
            status = await recoverFinalizeResponse(
              nativeClient,
              started,
              error,
            );
          }
          break;
        }
        batchIndex += 1;
      }
    }
  } catch (error) {
    failure = error;
  }

  if (failure !== undefined && nativeStarted) {
    try {
      await nativeClient.cancel(sessionId);
    } catch {
      // Preserve the primary failure. The native runtime remains fail-closed.
    }
  }
  try {
    await workerClient.cancel(sessionId);
  } catch (error) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
  if (!started || !status?.complete) {
    throw new Error("Browse generation did not complete");
  }
  return Object.freeze({
    binding: started.binding,
    filter: started.filter,
    status,
  });
}
