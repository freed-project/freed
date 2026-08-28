import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreSignatureInput,
  isLibraryCoreCanonicalRecord,
  LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_BYTES,
  LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_MEMBERS,
  libraryCoreFollowerResultBodyV1,
  parseLibraryCoreFollowerResultEnvelopeV1,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  type LibraryCoreEd25519SignatureHex,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  installPwaLibraryCoreFollowerEnrollment,
  preparePwaLibraryCoreFollowerEnrollment,
} from "./library-core-pwa-follower-enrollment";
import {
  activatePwaNormalizedCheckpointStage,
  applyPwaFollowerResult,
  appendPwaNormalizedCheckpointStagePage,
  beginPwaNormalizedCheckpointStage,
  pagePwaFollowerTransport,
  readPwaNormalizedCheckpointReceipt,
  readPwaFollowerTransportContext,
  resetPwaNormalizedLibrary,
} from "./library-core-sqlite-runtime";

let bootstrapTask: Promise<void> | null = null;
let authorityKeyId: LibraryCoreLowercaseHex64 | null = null;
let authorityPrivateKey: CryptoKey | null = null;
let previewActorId: LibraryCoreLowercaseHex64 | null = null;
let previewEpochId: LibraryCoreLowercaseHex64 | null = null;
let previewLibraryId: LibraryCoreLowercaseHex64 | null = null;
let previewNextActorCounter = 1;
let previewNextResultSequence = 1;
let previewPreviousResultDigest: LibraryCoreLowercaseHex64 | null = null;
let previewSourceRevision = 0;

function randomHex64(): LibraryCoreLowercaseHex64 {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  ) as LibraryCoreLowercaseHex64;
}

function lowerHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function digest(
  domain: LibraryCoreDigestDomain,
  value: unknown,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(
      domain,
      value as LibraryCoreCanonicalValue,
    ),
  );
}

async function createPreviewLibrary(): Promise<void> {
  const selected = await readPwaNormalizedCheckpointReceipt();
  if (selected.receipt && authorityPrivateKey !== null) return;
  if (selected.receipt) {
    await resetPwaNormalizedLibrary();
  }

  const createdAt = Date.now();
  const libraryId = randomHex64();
  const epochId = randomHex64();
  const writerActorId = randomHex64();
  const writerChainGenesis = randomHex64();
  const writerCapabilityId = randomHex64();
  const authorityKeys = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const authorityPublicKey = lowerHex(
    await crypto.subtle.exportKey("raw", authorityKeys.publicKey),
  );
  const nextAuthorityKeyId = digest("authority-key", {
    authority_public_key: authorityPublicKey,
    signature_algorithm: "ed25519",
  });
  const records = [
    createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint",
      payload: {
        authorityEpoch: epochId,
        checkpointId: `${libraryId}:${epochId}:0`,
        createdAtMs: createdAt,
        libraryId,
        schemaVersion: 1,
        sourceRevision: 0,
      },
    }),
    createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "01_authority_epoch",
      primaryKey: epochId,
      payload: {
        acceptedAt: createdAt,
        acceptedManifestGeneration: 0,
        authorityKeyId: nextAuthorityKeyId,
        authorityPublicKey,
        canonicalTransitionCertificate: "{}",
        checkpointFrontierDigest: digest("causal-frontier", []),
        epochNumber: 1,
        libraryId,
        materializedStateDigest: randomHex64(),
        transitionCertificateDigest: randomHex64(),
      },
    }),
    createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "03_active_authority",
      primaryKey: "active",
      payload: {
        acceptedManifestGeneration: 0,
        activatedAt: createdAt,
        activeKey: "active",
        epochId,
        libraryId,
        writerId: writerActorId,
      },
    }),
    createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "90_actor_state",
      primaryKey: writerActorId,
      payload: {
        acceptedChainDigest: writerChainGenesis,
        acceptedCounter: 0,
        acceptedOperationId: null,
        actorKind: "desktop",
        authorityEpochId: epochId,
        canonicalEnrollmentCertificate: "{}",
        chainGenesisDigest: writerChainGenesis,
        createdAt,
        enrollmentCertificateDigest: randomHex64(),
        enrollmentOperationId: `preview-writer:${writerActorId}`,
        publicKey: authorityPublicKey,
        retiredAt: null,
        updatedAt: createdAt,
      },
    }),
    createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "91_actor_capability",
      primaryKey: writerCapabilityId,
      payload: {
        actorClass: "editor",
        actorId: writerActorId,
        canonicalCertificate: "{}",
        certificateDigest: randomHex64(),
        certificateVersion: 2,
        issuanceIdentity: writerCapabilityId,
        issuedAt: createdAt,
        retiredAt: null,
        retirementCertificateDigest: null,
        retirementIdentity: randomHex64(),
        scopeId: null,
        scopeKind: null,
        scopeMode: "library_wide",
      },
    }),
  ] as const;
  const stageId = `preview:${randomHex64()}`;
  await beginPwaNormalizedCheckpointStage({
    authorityEpoch: epochId,
    createdAt,
    expectedRecordCount: records.length,
    libraryId,
    sourceRevision: 0,
    stageId,
  });
  await appendPwaNormalizedCheckpointStagePage({ records, stageId });
  await activatePwaNormalizedCheckpointStage({
    followerReceipt: {
      checkpointGeneration: 0,
      controlRevision: `preview:${randomHex64()}`,
      installedAt: createdAt,
      manifestContentDigest: randomHex64(),
      manifestObjectKey: `preview/checkpoint/${libraryId}`,
      manifestTransportObjectId: `preview:${randomHex64()}`,
      writerActorId,
    },
    replaceExisting: false,
    stageId,
  });

  const enrollment = await preparePwaLibraryCoreFollowerEnrollment();
  if (!enrollment) {
    throw new Error("PWA preview actor enrollment was not prepared");
  }
  const request = decodeLibraryCoreCanonicalValue(enrollment.source, {
    maximumBytes: 65_536,
  });
  if (
    typeof request !== "object" ||
    request === null ||
    Array.isArray(request)
  ) {
    throw new Error("PWA preview actor enrollment request is invalid");
  }
  const authoritySignature = lowerHex(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      authorityKeys.privateKey,
      exactArrayBuffer(
        encodeLibraryCoreSignatureInput("actor-capability-authority", {
          certificate_digest: enrollment.receipt.enrollmentRequestDigest,
        }),
      ),
    ),
  ) as LibraryCoreEd25519SignatureHex;
  const certificate = Object.freeze({
    ...(request as Readonly<Record<string, LibraryCoreCanonicalValue>>),
    authority_signature: authoritySignature,
  }) as LibraryCoreCanonicalValue;
  await installPwaLibraryCoreFollowerEnrollment({
    canonicalCertificateBytes: encodeLibraryCoreCanonicalValue(certificate, {
      maximumBytes: 65_536,
    }),
    enrolledAt: Date.now(),
  });
  authorityKeyId = nextAuthorityKeyId;
  authorityPrivateKey = authorityKeys.privateKey;
  previewActorId = enrollment.receipt.actorId;
  previewEpochId = epochId;
  previewLibraryId = libraryId;
  previewNextActorCounter = 1;
  previewNextResultSequence = 1;
  previewPreviousResultDigest = null;
  previewSourceRevision = 0;
}

/** Create one isolated, final-protocol SQLite Library for local previews. */
export async function ensurePwaLibraryCorePreviewState(): Promise<void> {
  bootstrapTask ??= createPreviewLibrary().finally(() => {
    bootstrapTask = null;
  });
  await bootstrapTask;
}

/** Resolve local preview intents through the exact signed follower result path. */
export async function settlePwaLibraryCorePreviewIntents(): Promise<void> {
  if (
    authorityKeyId === null ||
    authorityPrivateKey === null ||
    previewActorId === null ||
    previewEpochId === null ||
    previewLibraryId === null
  ) {
    throw new Error("PWA preview authority is unavailable");
  }
  const context = await readPwaFollowerTransportContext();
  if (
    context.actorId !== previewActorId ||
    context.libraryId !== previewLibraryId ||
    context.storageEpochId !== previewEpochId
  ) {
    throw new Error("PWA preview follower authority changed");
  }
  type BufferedEnvelope = Readonly<{
    bytes: Uint8Array;
    value: Readonly<Record<string, LibraryCoreCanonicalValue>>;
  }>;
  let buffered: BufferedEnvelope[] = [];
  let bufferedBytes = 0;
  let nextPageCounter = previewNextActorCounter;
  for (;;) {
    const page = await pagePwaFollowerTransport({
      actorId: previewActorId,
      firstActorCounter: nextPageCounter,
      limit: 128,
      schemaVersion: 2,
    });
    if (page.canonicalEnvelopes.length === 0) {
      if (buffered.length !== 0) {
        throw new Error("PWA preview intent transaction is incomplete");
      }
      return;
    }
    page.canonicalEnvelopes.forEach((bytes, pageIndex) => {
      const decoded = decodeLibraryCoreCanonicalValue(bytes, {
        maximumBytes: 131_072,
      });
      if (
        !isLibraryCoreCanonicalRecord(decoded) ||
        decoded.actor_sequence !== nextPageCounter + pageIndex
      ) {
        throw new Error("PWA preview intent actor sequence is not contiguous");
      }
      buffered.push({ bytes, value: decoded });
      bufferedBytes += bytes.byteLength;
    });
    nextPageCounter += page.canonicalEnvelopes.length;
    if (bufferedBytes > LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_BYTES) {
      throw new Error("PWA preview intent transaction exceeds its byte limit");
    }
    while (buffered.length !== 0) {
      const first = buffered[0]!.value;
      const transactionId = String(first.transaction_id);
      const memberCount = Number(first.transaction_member_count);
      if (
        !Number.isSafeInteger(memberCount) ||
        memberCount < 1 ||
        memberCount > LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_MEMBERS
      ) {
        throw new Error("PWA preview intent transaction size is invalid");
      }
      if (buffered.length < memberCount) break;
      const transaction = buffered.slice(0, memberCount);
      const members = transaction.map(({ value }) => value);
      if (
        members.some(
          (member, index) =>
            member.transaction_id !== transactionId ||
            member.transaction_member_count !== memberCount ||
            member.transaction_member_index !== index ||
            member.transaction_digest !== first.transaction_digest,
        )
      ) {
        throw new Error("PWA preview intent transaction changed identity");
      }
      const resolvedAt = Date.now();
      const operationIds = members.map((member) => String(member.operation_id));
      const unsigned = parseLibraryCoreFollowerResultEnvelopeV1({
        actor_id: previewActorId,
        authoritative_source_revision: previewSourceRevision + 1,
        authority_key_id: authorityKeyId,
        canonical_operation_ids: operationIds,
        epoch: 1,
        epoch_id: previewEpochId,
        format: "freed_follower_result_v1",
        intent_epoch: 1,
        intent_epoch_id: previewEpochId,
        library_id: previewLibraryId,
        original_result_digest: null,
        previous_result_digest: previewPreviousResultDigest,
        receipt_ids: operationIds,
        rejection_reason: null,
        replacement_fields: [],
        resolved_at_ms: resolvedAt,
        result_body_digest: "0".repeat(64),
        result_sequence: previewNextResultSequence,
        schema_version: 1,
        signature: "0".repeat(128),
        signature_algorithm: "ed25519",
        status: "accepted",
        transaction_digest: String(first.transaction_digest),
        transaction_id: transactionId,
      });
      const resultBodyDigest = digest(
        "follower-result-body",
        libraryCoreFollowerResultBodyV1(unsigned),
      );
      const signature = lowerHex(
        await crypto.subtle.sign(
          { name: "Ed25519" },
          authorityPrivateKey,
          exactArrayBuffer(
            encodeLibraryCoreSignatureInput("follower-result-envelope", {
              result_body_digest: resultBodyDigest,
            }),
          ),
        ),
      );
      const canonicalResultBytes = encodeLibraryCoreCanonicalValue(
        {
          ...unsigned,
          result_body_digest: resultBodyDigest,
          signature,
        } as unknown as LibraryCoreCanonicalValue,
        { maximumBytes: 131_072 },
      );
      await applyPwaFollowerResult({ canonicalResultBytes });
      previewPreviousResultDigest = resultBodyDigest;
      previewNextResultSequence += 1;
      previewSourceRevision += 1;
      previewNextActorCounter = Number(members.at(-1)!.actor_sequence) + 1;
      bufferedBytes -= transaction.reduce(
        (total, envelope) => total + envelope.bytes.byteLength,
        0,
      );
      buffered = buffered.slice(memberCount);
    }
    if (page.done) {
      if (buffered.length !== 0) {
        throw new Error("PWA preview intent transaction is incomplete");
      }
      return;
    }
  }
}
