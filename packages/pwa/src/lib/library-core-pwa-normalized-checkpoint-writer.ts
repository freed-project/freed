import type {
  LibraryCoreNormalizedCheckpointActivationReceiptV2,
  LibraryCoreNormalizedCheckpointRecordV2,
  LibraryCoreNormalizedCheckpointSelectionV2,
  LibraryCoreCheckpointManifestV1,
  LibraryCoreImmutableObjectReferenceV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreNormalizedCheckpointImportWriterV2,
} from "@freed/sync/cloud/library-core";
import {
  activatePwaNormalizedCheckpointStage,
  appendPwaNormalizedCheckpointStagePage,
  beginPwaNormalizedCheckpointStage,
  readPwaNormalizedCheckpointReceipt,
} from "./library-core-sqlite-runtime";

interface PwaNormalizedCheckpointWriterRuntime {
  readonly activate: typeof activatePwaNormalizedCheckpointStage;
  readonly appendPage: typeof appendPwaNormalizedCheckpointStagePage;
  readonly begin: typeof beginPwaNormalizedCheckpointStage;
  readonly readSelection: typeof readPwaNormalizedCheckpointReceipt;
}

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

function exactSelectionMatches(
  selection: LibraryCoreNormalizedCheckpointSelectionV2,
  manifest: LibraryCoreCheckpointManifestV1,
  reference: LibraryCoreImmutableObjectReferenceV1,
  input: CreatePwaNormalizedCheckpointWriterInput,
): boolean {
  const receipt = selection.receipt;
  return (
    receipt !== null &&
    receipt.libraryId === manifest.libraryId &&
    receipt.authorityEpoch === manifest.storageEpoch &&
    receipt.checkpointGeneration === input.checkpointGeneration &&
    receipt.manifestContentDigest === reference.descriptor.contentDigest &&
    receipt.manifestObjectKey === reference.descriptor.objectKey &&
    receipt.manifestTransportObjectId === reference.transportObjectId &&
    receipt.controlRevision === input.controlRevision &&
    receipt.writerActorId === input.writerActorId
  );
}

export function createPwaNormalizedCheckpointWriter(
  input: CreatePwaNormalizedCheckpointWriterInput,
): LibraryCoreNormalizedCheckpointImportWriterV2 {
  if (
    !Number.isSafeInteger(input.checkpointGeneration) ||
    input.checkpointGeneration < 0 ||
    !Number.isSafeInteger(input.installedAt) ||
    input.installedAt < 0 ||
    input.controlRevision.length === 0 ||
    input.writerActorId.length === 0
  ) {
    throw new TypeError("PWA normalized checkpoint writer identity is invalid");
  }
  const runtime = input.runtime ?? DEFAULT_RUNTIME;
  let stageId: string | null = null;
  let manifestReference: LibraryCoreImmutableObjectReferenceV1 | null = null;
  let nextPageIndex = 0;
  let replaceExisting = false;

  return Object.freeze({
    async prepareImport(
      manifest: LibraryCoreCheckpointManifestV1,
      reference: LibraryCoreImmutableObjectReferenceV1,
    ) {
      const selection = await runtime.readSelection();
      if (exactSelectionMatches(selection, manifest, reference, input)) {
        return "already_complete";
      }
      replaceExisting = selection.receipt !== null;
      return "import";
    },
    async beginImport({
      header,
      manifest,
      manifestReference: reference,
    }: {
      readonly header: LibraryCoreNormalizedCheckpointRecordV2;
      readonly manifest: LibraryCoreCheckpointManifestV1;
      readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
    }) {
      const nextStageId = reference.descriptor.contentDigest;
      stageId = nextStageId;
      manifestReference = reference;
      nextPageIndex = 0;
      await runtime.begin({
        authorityEpoch: manifest.storageEpoch,
        createdAt: input.installedAt,
        expectedRecordCount: manifest.totalRecordCount,
        libraryId: manifest.libraryId,
        sourceRevision: header.payload.sourceRevision as number,
        stageId: nextStageId,
      });
    },
    async appendPage(
      pageIndex: number,
      records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
    ) {
      if (stageId === null || pageIndex !== nextPageIndex) {
        throw new Error("PWA normalized checkpoint page order changed");
      }
      await runtime.appendPage({ records, stageId });
      nextPageIndex += 1;
    },
    async finalizeImport(): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2> {
      if (stageId === null || manifestReference === null) {
        throw new Error("PWA normalized checkpoint import did not begin");
      }
      return runtime.activate({
        followerReceipt: {
          checkpointGeneration: input.checkpointGeneration,
          controlRevision: input.controlRevision,
          installedAt: input.installedAt,
          manifestContentDigest:
            manifestReference.descriptor.contentDigest,
          manifestObjectKey: manifestReference.descriptor.objectKey,
          manifestTransportObjectId: manifestReference.transportObjectId,
          writerActorId: input.writerActorId,
        },
        replaceExisting,
        stageId,
      });
    },
  });
}
