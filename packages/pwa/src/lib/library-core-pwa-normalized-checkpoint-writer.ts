import {
  createLibraryCoreNormalizedCheckpointWriterV2,
  type LibraryCoreNormalizedCheckpointImportWriterV2,
  type LibraryCoreNormalizedCheckpointStageRuntimeV2,
} from "@freed/sync/cloud/library-core";
import {
  activatePwaNormalizedCheckpointStage,
  appendPwaNormalizedCheckpointStagePage,
  beginPwaNormalizedCheckpointStage,
  readPwaNormalizedCheckpointReceipt,
} from "./library-core-sqlite-runtime";

type PwaNormalizedCheckpointWriterRuntime =
  LibraryCoreNormalizedCheckpointStageRuntimeV2;

export interface CreatePwaNormalizedCheckpointWriterInput {
  readonly checkpointGeneration: number;
  readonly controlRevision: string;
  readonly installedAt: number;
  readonly runtime?: PwaNormalizedCheckpointWriterRuntime;
  readonly writerActorId: string;
}

const DEFAULT_RUNTIME = Object.freeze({
  activate: activatePwaNormalizedCheckpointStage,
  appendPage: appendPwaNormalizedCheckpointStagePage,
  begin: beginPwaNormalizedCheckpointStage,
  readSelection: readPwaNormalizedCheckpointReceipt,
}) satisfies PwaNormalizedCheckpointWriterRuntime;

/** Bind the shared normalized checkpoint staging protocol to browser SQLite. */
export function createPwaNormalizedCheckpointWriter(
  input: CreatePwaNormalizedCheckpointWriterInput,
): LibraryCoreNormalizedCheckpointImportWriterV2 {
  return createLibraryCoreNormalizedCheckpointWriterV2({
    ...input,
    runtime: input.runtime ?? DEFAULT_RUNTIME,
  });
}
