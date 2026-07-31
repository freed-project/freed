import {
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageSourceV1,
} from "@freed/shared/library-core";
import {
  importLibraryCoreCheckpointPagesV1,
  type LibraryCoreCheckpointPageReferenceV1,
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
  readonly expectedPageCount: number;
  readonly generation: number;
  readonly libraryId: string;
  readonly pages:
    | Iterable<LibraryCoreCheckpointPageReferenceV1>
    | AsyncIterable<LibraryCoreCheckpointPageReferenceV1>;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly totalRecordCount: number;
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
  const source = parseLibraryCoreFeedPageSourceV1(input.source);
  if (!source.ok) {
    throw new TypeError(`checkpoint source is invalid: ${source.error}`);
  }
  const generationState = await input.writer.beginGeneration({
    source: source.value,
    totalCount: input.totalRecordCount,
  });
  if (generationState === "complete") {
    return Object.freeze({
      importedPageCount: 0,
      importedRecordCount: 0,
      status: "already_complete",
    });
  }

  const imported = await importLibraryCoreCheckpointPagesV1({
    adapter: input.adapter,
    expectedPageCount: input.expectedPageCount,
    generation: input.generation,
    libraryId: input.libraryId,
    async onPage(pageIndex, records) {
      await input.writer.appendGenerationPage({
        batchIndex: pageIndex,
        rows: records,
        source: source.value,
      });
    },
    pages: input.pages,
    parseRecord: parseFeedCard,
    recordIdentity(record) {
      return record.globalId;
    },
    storageEpoch: input.storageEpoch,
    subtle: input.subtle,
    totalRecordCount: input.totalRecordCount,
  });
  await input.writer.finalizeGeneration(source.value);
  return Object.freeze({
    ...imported,
    status: "imported",
  });
}
