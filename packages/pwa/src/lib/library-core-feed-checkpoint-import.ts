import {
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreImmutableObjectReferenceV1,
} from "@freed/shared/library-core";
import {
  importLibraryCoreCheckpointManifestV1,
  type LibraryCoreImmutableReadAdapterV1,
} from "@freed/sync/cloud";

import type {
  AppendPwaLibraryCoreFeedGenerationPageInput,
  BeginPwaLibraryCoreFeedGenerationInput,
  PwaLibraryCoreFeedGenerationState,
} from "./library-core-feed-reader-runtime";

interface PwaLibraryCoreCheckpointWriter {
  appendGenerationPage(
    input: AppendPwaLibraryCoreFeedGenerationPageInput,
  ): Promise<void>;
  beginGeneration(
    input: BeginPwaLibraryCoreFeedGenerationInput,
  ): Promise<PwaLibraryCoreFeedGenerationState>;
  finalizeGeneration(source: LibraryCoreFeedPageSourceV1): Promise<void>;
}

export interface ImportPwaLibraryCoreFeedCheckpointInput {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly generation: number;
  readonly libraryId: string;
  readonly manifest: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly writer: PwaLibraryCoreCheckpointWriter;
}

export interface ImportPwaLibraryCoreFeedCheckpointResult {
  readonly importedPageCount: number;
  readonly importedRecordCount: number;
  readonly status: "already_complete" | "imported";
}

function parseFeedCard(value: unknown): LibraryCoreFeedCardV1 {
  const parsed = parseLibraryCoreFeedCardV1(value);
  if (!parsed.ok) {
    throw new TypeError(`checkpoint feed card is invalid: ${parsed.error}`);
  }
  return parsed.value;
}

/**
 * Import a verified portable feed-card projection into the existing bounded
 * IndexedDB generation runtime. The logical Library checkpoint remains the
 * authority source. This projection is disposable and can be rebuilt.
 */
export async function importPwaLibraryCoreFeedCheckpoint(
  input: ImportPwaLibraryCoreFeedCheckpointInput,
): Promise<ImportPwaLibraryCoreFeedCheckpointResult> {
  let source: LibraryCoreFeedPageSourceV1 | null = null;
  const imported = await importLibraryCoreCheckpointManifestV1({
    adapter: input.adapter,
    datasetSchemaId: "library_core_feed_card_projection_v1",
    generation: input.generation,
    libraryId: input.libraryId,
    manifest: input.manifest,
    async onPage(pageIndex, records) {
      if (source === null) {
        throw new TypeError("checkpoint source was not prepared");
      }
      await input.writer.appendGenerationPage({
        batchIndex: pageIndex,
        rows: records,
        source,
      });
    },
    parseRecord: parseFeedCard,
    async prepareImport(manifest, manifestReference) {
      const parsedSource = parseLibraryCoreFeedPageSourceV1({
        generationId: manifestReference.descriptor.contentDigest,
        projectionRevision: manifest.schemaVersion,
        transitionSequence: manifest.generation,
      });
      if (!parsedSource.ok) {
        throw new TypeError(
          `checkpoint source is invalid: ${parsedSource.error}`,
        );
      }
      source = parsedSource.value;
      const generationState = await input.writer.beginGeneration({
        source,
        totalCount: manifest.totalRecordCount,
      });
      return generationState === "complete" ? "already_complete" : "import";
    },
    recordIdentity(record) {
      return record.globalId;
    },
    storageEpoch: input.storageEpoch,
    subtle: input.subtle,
  });
  if (imported.status === "imported") {
    if (source === null) {
      throw new TypeError("checkpoint source was not prepared");
    }
    await input.writer.finalizeGeneration(source);
  }
  return Object.freeze({
    importedPageCount: imported.importedPageCount,
    importedRecordCount: imported.importedRecordCount,
    status: imported.status,
  });
}
