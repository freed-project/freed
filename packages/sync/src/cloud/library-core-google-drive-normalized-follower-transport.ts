import {
  decodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedIntentHeadV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreNormalizedIntentHeadV2,
} from "@freed/shared/library-core";
import type { LibraryCoreImmutableReadAdapterV1 } from "./library-core-immutable-publication.js";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreNormalizedIntentAdapterV2,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreResultSegmentsV1,
  provisionGoogleDriveLibraryCoreNormalizedIntentHeadV2,
  type GoogleDriveFetch,
} from "./library-core-google-drive-adapter.js";
import type {
  LibraryCoreNormalizedFollowerTransportV2,
} from "./library-core-normalized-follower-sync.js";
import type { LibraryCoreNormalizedHeadPublicationAdapterV2 } from "./library-core-normalized-segment-publication.js";

export interface GoogleDriveLibraryCoreNormalizedFollowerTransportOptionsV2 {
  readonly accessToken: string;
  readonly beforeProviderOperation?: () => void;
  readonly controlFileId: string;
  readonly googleFetch?: GoogleDriveFetch;
  readonly libraryId: string;
  readonly signal?: AbortSignal;
}

function enrollmentCertificateIdentity(bytes: Uint8Array): Readonly<{
  actorId: string;
  enrollmentRequestDigest: string;
}> | null {
  const value = decodeLibraryCoreCanonicalValue(bytes);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const certificateBody = (
    value as Readonly<Record<string, LibraryCoreCanonicalValue>>
  ).certificate_body;
  if (
    certificateBody === null ||
    typeof certificateBody !== "object" ||
    Array.isArray(certificateBody)
  ) {
    return null;
  }
  const body = certificateBody as Readonly<
    Record<string, LibraryCoreCanonicalValue>
  >;
  const enrollmentBody = body.actor_enrollment_body;
  if (
    enrollmentBody === null ||
    typeof enrollmentBody !== "object" ||
    Array.isArray(enrollmentBody)
  ) {
    return null;
  }
  const actorId = (
    enrollmentBody as Readonly<Record<string, LibraryCoreCanonicalValue>>
  ).actor_id;
  const enrollmentRequestDigest = body.enrollment_body_digest;
  return typeof actorId === "string" &&
    typeof enrollmentRequestDigest === "string"
    ? Object.freeze({ actorId, enrollmentRequestDigest })
    : null;
}

function guardImmutableReader(
  reader: LibraryCoreImmutableReadAdapterV1,
  beforeProviderOperation: () => void,
): LibraryCoreImmutableReadAdapterV1 {
  const guarded: LibraryCoreImmutableReadAdapterV1 = {
    async readImmutable(receipt) {
      beforeProviderOperation();
      return reader.readImmutable(receipt);
    },
  };
  return Object.freeze(guarded);
}

function guardIntentAdapter(
  adapter: LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedIntentHeadV2> &
    LibraryCoreImmutableReadAdapterV1,
  beforeProviderOperation: () => void,
): LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedIntentHeadV2> &
  LibraryCoreImmutableReadAdapterV1 {
  const guarded: LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedIntentHeadV2> &
    LibraryCoreImmutableReadAdapterV1 = {
    async compareAndSwapHead(input) {
      beforeProviderOperation();
      return adapter.compareAndSwapHead(input);
    },
    async putImmutable(object) {
      beforeProviderOperation();
      return adapter.putImmutable(object);
    },
    async readHead() {
      beforeProviderOperation();
      return adapter.readHead();
    },
    async readImmutable(receipt) {
      beforeProviderOperation();
      return adapter.readImmutable(receipt);
    },
    async verifyImmutable(receipt) {
      beforeProviderOperation();
      return adapter.verifyImmutable(receipt);
    },
  };
  return Object.freeze(guarded);
}

/**
 * Bind the provider-neutral normalized follower coordinator to Google Drive.
 * Scheduling, authentication refresh, local authority, and retry cadence stay
 * with the calling runtime.
 */
export function createGoogleDriveLibraryCoreNormalizedFollowerTransportV2(
  options: GoogleDriveLibraryCoreNormalizedFollowerTransportOptionsV2,
): LibraryCoreNormalizedFollowerTransportV2 {
  const beforeProviderOperation = options.beforeProviderOperation ?? (() => {});
  const immutable = createGoogleDriveLibraryCoreAdapterV1({
    accessToken: options.accessToken,
    controlFileId: options.controlFileId,
    googleFetch: options.googleFetch,
    libraryId: options.libraryId,
    signal: options.signal,
  });
  const resultReader = guardImmutableReader(immutable, beforeProviderOperation);
  const transport: LibraryCoreNormalizedFollowerTransportV2 = {
    async publishEnrollmentRequest(candidate) {
      beforeProviderOperation();
      const uploaded = await immutable.putImmutable({
        descriptor: candidate.descriptor,
        source: candidate.source,
      });
      beforeProviderOperation();
      const descriptor = await immutable.verifyImmutable({
        descriptor: candidate.descriptor,
        transportObjectId: uploaded.transportObjectId,
      });
      return parseLibraryCoreImmutableObjectReferenceV1({
        descriptor,
        transportObjectId: uploaded.transportObjectId,
      });
    },
    async readEnrollmentCertificate(request) {
      beforeProviderOperation();
      const enrollments = await discoverGoogleDriveLibraryCoreActorEnrollmentsV1({
        accessToken: options.accessToken,
        epochId: request.storageEpochId,
        googleFetch: options.googleFetch,
        libraryId: request.libraryId,
        signal: options.signal,
      });
      return (
        enrollments.find((candidate) => {
          const identity = enrollmentCertificateIdentity(candidate.bytes);
          return (
            identity !== null &&
            identity.actorId === request.actorId &&
            identity.enrollmentRequestDigest === request.enrollmentRequestDigest
          );
        })?.bytes ?? null
      );
    },
    async openIntentAdapter(context) {
      beforeProviderOperation();
      let locator = await discoverGoogleDriveLibraryCoreIntentHeadV1({
        accessToken: options.accessToken,
        actorId: context.actorId,
        epochId: context.storageEpochId,
        googleFetch: options.googleFetch,
        libraryId: context.libraryId,
        signal: options.signal,
      });
      if (locator === null) {
        beforeProviderOperation();
        locator = await provisionGoogleDriveLibraryCoreNormalizedIntentHeadV2({
          accessToken: options.accessToken,
          googleFetch: options.googleFetch,
          head: parseLibraryCoreNormalizedIntentHeadV2({
            actor_id: context.actorId,
            latest_segment: null,
            latest_segment_digest: null,
            library_id: context.libraryId,
            next_actor_counter: 1,
            protocol: "normalized_intent_head_v2",
            protocol_version: 2,
            storage_epoch_id: context.storageEpochId,
          }),
          signal: options.signal,
        });
      }
      const adapter = createGoogleDriveLibraryCoreNormalizedIntentAdapterV2({
        accessToken: options.accessToken,
        actorId: context.actorId,
        controlFileId: options.controlFileId,
        epochId: context.storageEpochId,
        googleFetch: options.googleFetch,
        intentHeadFileId: locator.intentHeadFileId,
        libraryId: context.libraryId,
        signal: options.signal,
      });
      return guardIntentAdapter(adapter, beforeProviderOperation);
    },
    async pageResultReferences(request) {
      beforeProviderOperation();
      const discovered = await discoverGoogleDriveLibraryCoreResultSegmentsV1({
        accessToken: options.accessToken,
        actorId: request.actorId,
        epochId: request.storageEpochId,
        googleFetch: options.googleFetch,
        libraryId: request.libraryId,
        signal: options.signal,
      });
      const remaining = discovered.filter(
        (segment) => segment.lastResultSequence >= request.firstResultSequence,
      );
      return Object.freeze({
        done: remaining.length <= request.limit,
        references: Object.freeze(
          remaining.slice(0, request.limit).map((segment) => segment.reference),
        ),
      });
    },
    resultReader,
  };
  return Object.freeze(transport);
}
