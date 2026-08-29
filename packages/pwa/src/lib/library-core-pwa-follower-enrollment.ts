import {
  constructLibraryCoreActorCapabilityRequestV2,
  constructLibraryCoreActorEnrollmentBodyV1,
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  type LibraryCoreFollowerActorEnrollmentReceiptV2,
  type LibraryCoreFollowerActorRequestReceiptV2,
  type LibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreInstallFollowerActorEnrollmentV2,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  getOrCreatePwaLibraryCoreActorIdentity,
  signPwaLibraryCoreActorProof,
} from "./library-core-browser-key-vault";
import {
  installPwaFollowerActorEnrollment,
  readPwaFollowerActorEnrollmentContext,
  storePwaFollowerActorRequest,
} from "./library-core-sqlite-runtime";

interface PwaFollowerEnrollmentRuntime {
  readonly getOrCreateIdentity: typeof getOrCreatePwaLibraryCoreActorIdentity;
  readonly installEnrollment: typeof installPwaFollowerActorEnrollment;
  readonly now: () => number;
  readonly readContext: typeof readPwaFollowerActorEnrollmentContext;
  readonly signActorProof: typeof signPwaLibraryCoreActorProof;
  readonly storeRequest: typeof storePwaFollowerActorRequest;
}

const DEFAULT_RUNTIME = Object.freeze({
  getOrCreateIdentity: getOrCreatePwaLibraryCoreActorIdentity,
  installEnrollment: installPwaFollowerActorEnrollment,
  now: Date.now,
  readContext: readPwaFollowerActorEnrollmentContext,
  signActorProof: signPwaLibraryCoreActorProof,
  storeRequest: storePwaFollowerActorRequest,
}) satisfies PwaFollowerEnrollmentRuntime;

function digest(
  domain: LibraryCoreDigestDomain,
  value: unknown,
): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(
    encodeLibraryCoreDigestInput(domain, value as LibraryCoreCanonicalValue),
  );
}

export interface PwaLibraryCoreFollowerEnrollmentCandidateV2 {
  readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
  readonly libraryId: LibraryCoreLowercaseHex64;
  readonly receipt: LibraryCoreFollowerActorRequestReceiptV2;
  readonly source: Uint8Array;
  readonly storageEpochId: LibraryCoreLowercaseHex64;
}

export async function preparePwaLibraryCoreFollowerEnrollment(
  runtime: PwaFollowerEnrollmentRuntime = DEFAULT_RUNTIME,
): Promise<PwaLibraryCoreFollowerEnrollmentCandidateV2 | null> {
  const context = await runtime.readContext();
  if (context.request?.state === "enrolled") return null;
  if (context.request) {
    return Object.freeze({
      descriptor: Object.freeze({
        byteLength: context.request.canonicalRequestBytes.byteLength,
        contentDigest: sha256LowerHex(context.request.canonicalRequestBytes),
        objectKey: createLibraryCoreImmutableObjectKey({
          actorId: context.request.actorId,
          digest: sha256LowerHex(context.request.canonicalRequestBytes),
          epochId: context.authority.epoch_id,
          kind: "actor_enrollment_request",
          libraryId: context.authority.library_id,
        }),
      }),
      libraryId: context.authority.library_id,
      receipt: context.request,
      source: new Uint8Array(context.request.canonicalRequestBytes),
      storageEpochId: context.authority.epoch_id,
    });
  }
  const identity = await runtime.getOrCreateIdentity(
    context.authority.library_id,
  );
  const createdAt = runtime.now();
  const enrollment = constructLibraryCoreActorEnrollmentBodyV1(
    {
      actor_incarnation_nonce: identity.actorIncarnationNonce,
      actor_public_key: identity.actorPublicKey,
      authority_key_id: context.authority.authority_key_id,
      created_at_ms: createdAt,
      epoch: context.authority.epoch,
      epoch_id: context.authority.epoch_id,
      installation_incarnation: identity.installationIncarnation,
      library_id: context.authority.library_id,
      observed_frontier: context.authority.observed_frontier,
      operation_id: `actor-enrolled:${identity.actorId}`,
    },
    { digest },
  );
  if (enrollment.body.actor_id !== identity.actorId) {
    throw new Error("PWA follower actor identity changed during enrollment");
  }
  const request = await constructLibraryCoreActorCapabilityRequestV2(
    enrollment,
    {
      actor_class: "editor",
      allowed_operation_types: LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
      allowed_query_ids: [],
      scope: { mode: "library_wide" },
    },
    {
      digest,
      signActorProof: (message) => runtime.signActorProof(identity, message),
    },
  );
  const source = encodeLibraryCoreCanonicalValue(
    request.request as unknown as LibraryCoreCanonicalValue,
    { maximumBytes: 65_536 },
  );
  const receipt = await runtime.storeRequest({
    canonicalRequestBytes: source,
    createdAt,
  });
  const contentDigest = sha256LowerHex(source);
  return Object.freeze({
    descriptor: Object.freeze({
      byteLength: source.byteLength,
      contentDigest,
      objectKey: createLibraryCoreImmutableObjectKey({
        actorId: receipt.actorId,
        digest: contentDigest,
        epochId: context.authority.epoch_id,
        kind: "actor_enrollment_request",
        libraryId: context.authority.library_id,
      }),
    }),
    libraryId: context.authority.library_id,
    receipt,
    source,
    storageEpochId: context.authority.epoch_id,
  });
}

export async function installPwaLibraryCoreFollowerEnrollment(
  input: LibraryCoreInstallFollowerActorEnrollmentV2,
  runtime: Pick<
    PwaFollowerEnrollmentRuntime,
    "installEnrollment"
  > = DEFAULT_RUNTIME,
): Promise<LibraryCoreFollowerActorEnrollmentReceiptV2> {
  return runtime.installEnrollment(input);
}
