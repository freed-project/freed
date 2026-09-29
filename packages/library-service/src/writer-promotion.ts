import { createHash } from "node:crypto";
import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreControlPointerV1,
} from "@freed/shared/library-core";
import {
  reassignLibraryCoreNormalizedCheckpointV2,
  type LibraryCoreImmutablePublicationAdapterV1,
  type LibraryCoreImmutableReadAdapterV1,
} from "@freed/sync/cloud/library-core";
import { LibraryServiceFailure } from "./contracts.js";
import {
  checkpointRecords,
  type LibraryServiceGoogleDrivePublicationStatePortV1,
} from "./google-drive-publication.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import { verifyPreparedWriterCheckpoint } from "./writer-promotion-verification.js";

export interface WriterPromotionRequest {
  readonly sourceControl: LibraryCoreControlPointerV1;
  readonly expectedRevision: string;
  readonly controlFileId: string;
  readonly installationWitness: string;
  readonly acceptedAtMs: number;
}

function canonical(value: unknown): string {
  return new TextDecoder().decode(
    encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue),
  );
}

export function parseWriterPromotionRequest(
  value: unknown,
): WriterPromotionRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryServiceFailure("config_invalid");
  }
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "acceptedAtMs,controlFileId,expectedRevision,installationWitness,sourceControl" ||
    typeof row.installationWitness !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.installationWitness) ||
    !Number.isSafeInteger(row.acceptedAtMs) ||
    (row.acceptedAtMs as number) < 0 ||
    ![row.controlFileId, row.expectedRevision].every(
      (v) =>
        typeof v === "string" && v.length > 0 && Buffer.byteLength(v) <= 512,
    )
  ) {
    throw new LibraryServiceFailure("config_invalid");
  }
  const sourceControl = parseLibraryCoreControlPointerV1(row.sourceControl);
  if (
    ![
      sourceControl.libraryId,
      sourceControl.storageEpoch,
      sourceControl.writerId,
    ].every((v) => /^[a-f0-9]{64}$/.test(v)) ||
    sourceControl.activeTransport !== "google_drive_app_data_v1"
  )
    throw new LibraryServiceFailure("config_invalid");
  return Object.freeze({
    ...row,
    sourceControl,
  }) as unknown as WriterPromotionRequest;
}

/** Execute one explicit, durable, expected-control transfer under the service lease. */
export async function promoteLibraryServiceWriter(
  request: WriterPromotionRequest,
  ports: {
    native: LibraryCoreNativeCommandClientV1;
    adapter: LibraryCoreImmutablePublicationAdapterV1<Uint8Array> &
      LibraryCoreImmutableReadAdapterV1;
    state: LibraryServiceGoogleDrivePublicationStatePortV1;
    retainRequest(canonicalRequest: string): Promise<void>;
    signal: AbortSignal;
  },
) {
  const input = parseWriterPromotionRequest(request);
  const { native, adapter, signal } = ports;
  signal.throwIfAborted();
  await native.execute("cloud_writer_clear_v1", {});
  try {
    // Durable before native preparation. Changed retries never reach native or CAS.
    await ports.retainRequest(canonical(input));
    signal.throwIfAborted();
    const identity = (await native.execute("primary_actor_identity_v1", {
      installationWitness: input.installationWitness,
    })) as { actorId: string; libraryId: string };
    if (
      identity?.libraryId !== input.sourceControl.libraryId ||
      !/^[a-f0-9]{64}$/.test(identity.actorId) ||
      identity.actorId === input.sourceControl.writerId
    ) {
      throw new LibraryServiceFailure("authority_not_primary");
    }
    const readControl = async () => {
      signal.throwIfAborted();
      const read = await adapter.readControl();
      signal.throwIfAborted();
      if (read.bytes === null || read.revision === null)
        throw new LibraryServiceFailure("authority_not_primary");
      return {
        revision: read.revision,
        pointer: parseLibraryCoreControlPointerV1(
          decodeLibraryCoreCanonicalValue(read.bytes),
        ),
      };
    };
    const before = await readControl();
    const local = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
      await native.execute("describe_checkpoint_export_v2", {}),
    );
    const fresh =
      String(local.authorityEpoch) === String(input.sourceControl.storageEpoch);
    if (fresh) {
      if (
        before.revision !== input.expectedRevision ||
        canonical(before.pointer) !== canonical(input.sourceControl)
      )
        throw new LibraryServiceFailure("authority_not_primary");
      // Verify the complete source content, not just its writer/frontier fields.
      await verifyPreparedWriterCheckpoint({
        native,
        adapter,
        pointer: input.sourceControl,
        signal,
        subtle: crypto.subtle,
        requireGenerationZero: false,
      });
    }
    const prepared = (await native.execute("reassign_writer_epoch_v2", {
      canonicalSourceControlJson: canonical(input.sourceControl),
      targetWriterId: identity.actorId,
      installationWitness: input.installationWitness,
      acceptedAtMs: input.acceptedAtMs,
    })) as {
      authority: { epochId: string };
      canonicalEpochCertificateJson: string;
    };
    const snapshot = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
      await native.execute("begin_checkpoint_export_v2", {}),
    );
    if (
      String(snapshot.libraryId) !== String(input.sourceControl.libraryId) ||
      snapshot.writerId !== identity.actorId ||
      snapshot.authorityEpoch !== prepared?.authority?.epochId ||
      snapshot.sourceRevision !== local.sourceRevision
    ) {
      throw new LibraryServiceFailure("command_response_invalid");
    }
    const source = new TextEncoder().encode(
      prepared.canonicalEpochCertificateJson,
    );
    // Native creates and verifies the retained signed certificate; shared publication
    // verifies its source tuple and target before conditional publication.
    const digest = createHash("sha256").update(source).digest("hex");
    const epochCertificate = {
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        byteLength: source.byteLength,
        contentDigest: digest,
        objectKey: createLibraryCoreImmutableObjectKey({
          digest,
          epochId: snapshot.authorityEpoch,
          kind: "epoch_certificate",
          libraryId: snapshot.libraryId,
        }),
      }),
      source,
    };
    const current = await readControl();
    let committed = current;
    if (
      current.revision === input.expectedRevision &&
      canonical(current.pointer) === canonical(input.sourceControl)
    ) {
      signal.throwIfAborted();
      const result = await reassignLibraryCoreNormalizedCheckpointV2({
        activeTransport: "google_drive_app_data_v1",
        adapter,
        descriptor: snapshot,
        epochCertificate,
        expectedControl: {
          pointer: input.sourceControl,
          revision: input.expectedRevision,
        },
        generation: 0,
        records: checkpointRecords(native, snapshot),
        subtle: crypto.subtle,
      });
      if (result.status === "conflict")
        throw new LibraryServiceFailure("authority_not_primary");
      committed = { pointer: result.controlPointer, revision: result.revision };
    }
    // Includes the exact canonical authority certificate within the checkpoint rows.
    // A competitor with a matching epoch label but different content cannot recover.
    const receipt = await verifyPreparedWriterCheckpoint({
      native,
      adapter,
      pointer: committed.pointer,
      signal,
      subtle: crypto.subtle,
    });
    const confirmed = await readControl();
    if (
      confirmed.revision !== committed.revision ||
      canonical(confirmed.pointer) !== canonical(committed.pointer)
    )
      throw new LibraryServiceFailure("authority_not_primary");
    await ports.state.write({
      schemaVersion: 1,
      libraryId: snapshot.libraryId,
      authorityEpoch: snapshot.authorityEpoch,
      writerId: snapshot.writerId,
      controlFileId: input.controlFileId,
      controlRevision: confirmed.revision,
      lastPublishedRevision: snapshot.sourceRevision,
    });
    signal.throwIfAborted();
    const admission = await native.execute("cloud_writer_observe_v1", {
      libraryId: snapshot.libraryId,
      localWriterId: snapshot.writerId,
      activeWriterId: confirmed.pointer.writerId,
      storageEpoch: confirmed.pointer.storageEpoch,
      controlRevision: confirmed.revision,
      verifiedAtMs: Date.now(),
    });
    if (canonical(admission) !== '{"allowed":true}')
      throw new LibraryServiceFailure("authority_not_primary");
    return {
      status: "writer_transferred" as const,
      controlRevision: confirmed.revision,
      authorityEpoch: snapshot.authorityEpoch,
      sourceRevision: snapshot.sourceRevision,
      ...receipt,
    };
  } catch (error) {
    await native.execute("cloud_writer_clear_v1", {});
    throw error;
  }
}
