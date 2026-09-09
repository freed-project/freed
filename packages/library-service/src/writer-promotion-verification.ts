import {
  createLibraryCoreNormalizedCheckpointDigestAccumulatorV2,
  LIBRARY_CORE_NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID,
  libraryCoreNormalizedCheckpointRecordIdentityV2,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreControlPointerV1,
} from "@freed/shared/library-core";
import {
  importLibraryCoreCheckpointManifestV1,
  type LibraryCoreImmutableReadAdapterV1,
} from "@freed/sync/cloud/library-core";
import { LibraryServiceFailure } from "./contracts.js";
import { checkpointRecords } from "./google-drive-publication.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";

/** Prove remote logical content equals the prepared native transfer without activating either. */
export async function verifyPreparedWriterCheckpoint(input: {
  native: LibraryCoreNativeCommandClientV1;
  adapter: LibraryCoreImmutableReadAdapterV1;
  pointer: LibraryCoreControlPointerV1;
  signal: AbortSignal;
  subtle: SubtleCrypto;
}) {
  input.signal.throwIfAborted();
  const pointer = parseLibraryCoreControlPointerV1(input.pointer);
  const snapshot = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    await input.native.execute("begin_checkpoint_export_v2", {}),
  );
  if (
    pointer.generation !== 0 ||
    String(pointer.libraryId) !== snapshot.libraryId ||
    String(pointer.storageEpoch) !== snapshot.authorityEpoch ||
    String(pointer.writerId) !== snapshot.writerId ||
    pointer.causalFrontierDigest !== snapshot.causalFrontierDigest
  ) {
    throw new LibraryServiceFailure("authority_not_primary");
  }
  const local = createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
  for await (const record of checkpointRecords(input.native, snapshot)) {
    input.signal.throwIfAborted();
    local.push(record);
  }
  const expected = local.finish();
  const remote = createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
  const imported = await importLibraryCoreCheckpointManifestV1({
    adapter: {
      async readImmutable(reference) {
        input.signal.throwIfAborted();
        const bytes = await input.adapter.readImmutable(reference);
        input.signal.throwIfAborted();
        return bytes;
      },
    },
    datasetSchemaId: LIBRARY_CORE_NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID,
    generation: pointer.generation,
    libraryId: pointer.libraryId,
    manifest: pointer.manifest,
    storageEpoch: pointer.storageEpoch,
    subtle: input.subtle,
    parseRecord: parseLibraryCoreNormalizedCheckpointRecordV2,
    recordIdentity: libraryCoreNormalizedCheckpointRecordIdentityV2,
    async onPage(_index, records) {
      input.signal.throwIfAborted();
      for (const record of records) remote.push(record);
    },
  });
  const observed = remote.finish();
  const current = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    await input.native.execute("describe_checkpoint_export_v2", {}),
  );
  input.signal.throwIfAborted();
  if (
    imported.causalFrontierDigest !== snapshot.causalFrontierDigest ||
    observed.checkpointDigest !== expected.checkpointDigest ||
    observed.recordCount !== expected.recordCount ||
    observed.canonicalBytes !== expected.canonicalBytes ||
    JSON.stringify(current) !== JSON.stringify(snapshot)
  ) {
    throw new LibraryServiceFailure("bound_input_changed");
  }
  return expected;
}
