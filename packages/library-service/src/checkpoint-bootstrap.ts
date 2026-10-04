import {
  parseLibraryCoreNormalizedCheckpointActivationReceiptV2,
  parseLibraryCoreNormalizedCheckpointStageStatusV2,
  type LibraryCoreImmutableObjectReferenceV1,
} from "@freed/shared/library-core";
import {
  createLibraryCoreNormalizedCheckpointWriterV2,
  importLibraryCoreNormalizedCheckpointV2,
  type LibraryCoreImmutableReadAdapterV1,
} from "@freed/sync/cloud/library-core";
import { LibraryServiceFailure } from "./contracts.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";

export interface LibraryServiceCheckpointBootstrapInput {
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly generation: number;
  readonly manifest: LibraryCoreImmutableObjectReferenceV1;
  readonly controlRevision: string;
  readonly installedAt: number;
  readonly installationWitness: string;
}

/** Import a pinned logical checkpoint without granting this installation writer authority. */
export async function importLibraryServiceCheckpoint(
  input: LibraryServiceCheckpointBootstrapInput,
  ports: {
    readonly native: LibraryCoreNativeCommandClientV1;
    readonly adapter: LibraryCoreImmutableReadAdapterV1;
    readonly signal: AbortSignal;
    readonly subtle: SubtleCrypto;
  },
) {
  const execute: LibraryCoreNativeCommandClientV1["execute"] = async (command, payload) => {
    ports.signal.throwIfAborted();
    const response = await ports.native.execute(command, payload);
    ports.signal.throwIfAborted();
    return response;
  };
  const identity = await execute("primary_actor_identity_v1", {
    installationWitness: input.installationWitness,
  });
  if (
    identity === null || typeof identity !== "object" || Array.isArray(identity) ||
    Object.keys(identity).sort().join(",") !== "actorId,libraryId" ||
    (identity as { libraryId: unknown }).libraryId !== input.libraryId
  ) {
    throw new LibraryServiceFailure("authority_not_primary");
  }
  const writer = createLibraryCoreNormalizedCheckpointWriterV2({
    checkpointGeneration: input.generation,
    controlRevision: input.controlRevision,
    installedAt: input.installedAt,
    writerActorId: null,
    runtime: {
      async begin(stage) {
        return parseLibraryCoreNormalizedCheckpointStageStatusV2(
          await execute("begin_checkpoint_stage_v2", { ...stage }),
        );
      },
      async appendPage(page) {
        return parseLibraryCoreNormalizedCheckpointStageStatusV2(
          await execute("append_checkpoint_stage_v2", { ...page }),
        );
      },
      async activate(selection) {
        if (selection.replaceExisting || selection.followerReceipt !== null) {
          throw new LibraryServiceFailure("command_response_invalid");
        }
        return parseLibraryCoreNormalizedCheckpointActivationReceiptV2(
          await execute("finalize_checkpoint_stage_v2", { stageId: selection.stageId }),
        );
      },
    },
  });
  return importLibraryCoreNormalizedCheckpointV2({
    ...input,
    subtle: ports.subtle,
    writer,
    adapter: {
      async readImmutable(receipt) {
        ports.signal.throwIfAborted();
        const bytes = await ports.adapter.readImmutable(receipt);
        ports.signal.throwIfAborted();
        return bytes;
      },
    },
  });
}
