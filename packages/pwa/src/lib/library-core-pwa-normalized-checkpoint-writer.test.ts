import { describe, expect, it, vi } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreNormalizedCheckpointRecordV2,
  isLibraryCoreLowercaseHex64,
  parseLibraryCoreCheckpointManifestV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedCheckpointSelectionV2,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { createPwaNormalizedCheckpointWriter } from "./library-core-pwa-normalized-checkpoint-writer";

const DIGEST = {
  checkpoint: "11".repeat(32),
  control: "22".repeat(32),
  epoch: "33".repeat(32),
  frontier: "44".repeat(32),
  library: "55".repeat(32),
  writer: "66".repeat(32),
} as const;

function lowercaseHex64(value: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError("invalid test lowercase hexadecimal digest");
  }
  return value;
}

function fixture() {
  const reference = parseLibraryCoreImmutableObjectReferenceV1({
    descriptor: {
      byteLength: 1_024,
      contentDigest: DIGEST.checkpoint,
      objectKey: createLibraryCoreImmutableObjectKey({
        digest: DIGEST.checkpoint,
        epochId: DIGEST.epoch,
        generation: 7,
        kind: "checkpoint_manifest",
        libraryId: DIGEST.library,
      }),
    },
    transportObjectId: "drive-manifest-1",
  });
  const pageReference = parseLibraryCoreImmutableObjectReferenceV1({
    descriptor: {
      byteLength: 2_048,
      contentDigest: "77".repeat(32),
      objectKey: createLibraryCoreImmutableObjectKey({
        digest: "77".repeat(32),
        epochId: DIGEST.epoch,
        generation: 7,
        kind: "checkpoint_page",
        libraryId: DIGEST.library,
        pageIndex: 0,
      }),
    },
    transportObjectId: "drive-page-1",
  });
  const manifest = parseLibraryCoreCheckpointManifestV1({
    causalFrontierDigest: DIGEST.frontier,
    datasetSchemaId: "library_core_normalized_checkpoint_v2",
    generation: 7,
    kind: "checkpoint_manifest",
    libraryId: DIGEST.library,
    pages: [
      {
        firstRecordIdentity: "00_checkpoint_header:checkpoint",
        lastRecordIdentity: "00_checkpoint_header:checkpoint",
        object: pageReference,
        pageIndex: 0,
        recordCount: 1,
      },
    ],
    protocolVersion: 1,
    schemaVersion: 1,
    storageEpoch: DIGEST.epoch,
    totalRecordCount: 1,
  });
  const header = createLibraryCoreNormalizedCheckpointRecordV2({
    registryKey: "00_checkpoint_header",
    primaryKey: "checkpoint",
    payload: {
      authorityEpoch: DIGEST.epoch,
      checkpointId: `${DIGEST.library}:${DIGEST.epoch}:9`,
      createdAtMs: 1_000,
      libraryId: DIGEST.library,
      schemaVersion: 1,
      sourceRevision: 9,
    },
  });
  return { header, manifest, reference };
}

describe("PWA normalized checkpoint writer", () => {
  it("stages bounded pages and activates one exact follower receipt", async () => {
    const { header, manifest, reference } = fixture();
    const activate = vi.fn(async (activation) => ({
      authorityEpoch: DIGEST.epoch,
      canonicalBytes: 512,
      checkpointDigest: lowercaseHex64(DIGEST.checkpoint),
      libraryId: DIGEST.library,
      recordCount: 1,
      sourceRevision: 9,
      stageId: activation.stageId,
    }));
    const begin = vi.fn(async () => ({
      complete: false,
      expectedRecordCount: 1,
      stagedCanonicalBytes: 0,
      stagedRecordCount: 0,
      stageId: DIGEST.checkpoint,
    }));
    const appendPage = vi.fn(async () => ({
      complete: true,
      expectedRecordCount: 1,
      stagedCanonicalBytes: 512,
      stagedRecordCount: 1,
      stageId: DIGEST.checkpoint,
    }));
    const writer = createPwaNormalizedCheckpointWriter({
      checkpointGeneration: 7,
      controlRevision: DIGEST.control,
      installedAt: 2_000,
      runtime: {
        activate,
        appendPage,
        begin,
        readSelection: vi.fn(async () => ({ receipt: null })),
      },
      writerActorId: DIGEST.writer,
    });

    await expect(writer.prepareImport!(manifest, reference)).resolves.toBe(
      "import",
    );
    await writer.beginImport({ header, manifest, manifestReference: reference });
    await writer.appendPage(0, [header]);
    await writer.finalizeImport({
      canonicalBytes: 512,
      checkpointDigest: lowercaseHex64(DIGEST.checkpoint),
      recordCount: 1,
    });

    expect(begin).toHaveBeenCalledWith({
      authorityEpoch: DIGEST.epoch,
      createdAt: 2_000,
      expectedRecordCount: 1,
      libraryId: DIGEST.library,
      sourceRevision: 9,
      stageId: DIGEST.checkpoint,
    });
    expect(appendPage).toHaveBeenCalledWith({
      records: [header],
      stageId: DIGEST.checkpoint,
    });
    expect(activate).toHaveBeenCalledWith({
      followerReceipt: {
        checkpointGeneration: 7,
        controlRevision: DIGEST.control,
        installedAt: 2_000,
        manifestContentDigest: DIGEST.checkpoint,
        manifestObjectKey: reference.descriptor.objectKey,
        manifestTransportObjectId: "drive-manifest-1",
        writerActorId: DIGEST.writer,
      },
      replaceExisting: false,
      stageId: DIGEST.checkpoint,
    });
  });

  it("recognizes only the exact installed checkpoint as complete", async () => {
    const { manifest, reference } = fixture();
    const selection = parseLibraryCoreNormalizedCheckpointSelectionV2({
      receipt: {
        authorityEpoch: DIGEST.epoch,
        checkpointDigest: DIGEST.checkpoint,
        checkpointGeneration: 7,
        controlRevision: DIGEST.control,
        installedAt: 2_000,
        libraryId: DIGEST.library,
        manifestContentDigest: DIGEST.checkpoint,
        manifestObjectKey: reference.descriptor.objectKey,
        manifestTransportObjectId: reference.transportObjectId,
        sourceRevision: 9,
        writerActorId: DIGEST.writer,
      },
    });
    const writer = createPwaNormalizedCheckpointWriter({
      checkpointGeneration: 7,
      controlRevision: DIGEST.control,
      installedAt: 3_000,
      runtime: {
        activate: vi.fn(),
        appendPage: vi.fn(),
        begin: vi.fn(),
        readSelection: vi.fn(async () => selection),
      },
      writerActorId: DIGEST.writer,
    });

    await expect(writer.prepareImport!(manifest, reference)).resolves.toBe(
      "already_complete",
    );
  });
});
