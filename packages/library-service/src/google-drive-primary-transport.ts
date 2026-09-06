import {
  decodeLibraryCoreCanonicalValue,
  isLibraryCoreLowercaseHex64,
  parseLibraryCoreNormalizedIntentHeadV2,
  parseLibraryCoreNormalizedResultHeadV2,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  createGoogleDriveLibraryCoreNormalizedIntentAdapterV2,
  createGoogleDriveLibraryCoreNormalizedResultAdapterV2,
  discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1,
  discoverGoogleDriveLibraryCoreActorEnrollmentsV1,
  discoverGoogleDriveLibraryCoreIntentHeadV1,
  discoverGoogleDriveLibraryCoreIntentSegmentsV1,
  discoverGoogleDriveLibraryCoreResultHeadV1,
  provisionGoogleDriveLibraryCoreNormalizedResultHeadV2,
  type GoogleDriveFetch,
} from "@freed/sync/cloud/library-core";
import type { LibraryServiceNormalizedPrimaryTransportV2 } from "./normalized-primary-orchestration.js";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid normalized enrollment identity");
  }
  return value as Record<string, unknown>;
}

/** Bind one authority-checked refresh to existing bounded Drive adapters. */
export function createGoogleDrivePrimaryTransportV2(
  options: Readonly<{
    accessToken: string;
    controlFileId: string;
    libraryId: string;
    epochId: string;
    signal: AbortSignal;
    googleFetch?: GoogleDriveFetch;
  }>,
): LibraryServiceNormalizedPrimaryTransportV2 {
  const guard = () => options.signal.throwIfAborted();
  const immutable = createGoogleDriveLibraryCoreAdapterV1(options);
  const scope = (libraryId: string, epochId: string) => {
    guard();
    if (libraryId !== options.libraryId || epochId !== options.epochId) {
      throw new Error("normalized Primary transport authority changed");
    }
  };
  const certificates = async () => {
    guard();
    const values =
      await discoverGoogleDriveLibraryCoreActorEnrollmentsV1(options);
    return values.map(({ bytes }) => {
      const body = record(
        record(decodeLibraryCoreCanonicalValue(bytes)).certificate_body,
      );
      const actor = record(body.actor_enrollment_body);
      scope(String(actor.library_id), String(actor.epoch_id));
      if (
        !isLibraryCoreLowercaseHex64(actor.actor_id) ||
        !isLibraryCoreLowercaseHex64(body.enrollment_body_digest)
      ) {
        throw new Error("invalid normalized enrollment identity");
      }
      return {
        actorId: actor.actor_id,
        requestDigest: body.enrollment_body_digest,
      };
    });
  };
  return {
    intentReader: immutable,
    async pageEnrollmentRequests(input) {
      scope(input.libraryId, input.storageEpochId);
      const enrolled = new Set(
        (await certificates()).map((value) => value.requestDigest),
      );
      guard();
      const requests =
        await discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1(options);
      const pending = requests.filter(({ bytes }) => {
        const value = record(decodeLibraryCoreCanonicalValue(bytes));
        return !enrolled.has(
          value.enrollment_body_digest as LibraryCoreLowercaseHex64,
        );
      });
      return {
        done: pending.length <= input.limit,
        requests: pending.slice(0, input.limit),
      };
    },
    async publishEnrollmentCertificate({ certificate }) {
      guard();
      const uploaded = await immutable.putImmutable(certificate);
      guard();
      const descriptor = await immutable.verifyImmutable({
        descriptor: certificate.descriptor,
        transportObjectId: uploaded.transportObjectId,
      });
      return { descriptor, transportObjectId: uploaded.transportObjectId };
    },
    async pageActors(input) {
      scope(input.libraryId, input.storageEpochId);
      const actors = [
        ...new Set((await certificates()).map((value) => value.actorId)),
      ]
        .sort()
        .filter(
          (actor) => input.afterActorId === null || actor > input.afterActorId,
        );
      const actorIds = actors.slice(0, input.limit);
      return {
        actorIds,
        done: actors.length <= input.limit,
        nextActorId: actorIds.at(-1) ?? null,
      };
    },
    async pageIntentReferences(input) {
      scope(input.libraryId, input.storageEpochId);
      const context = { ...options, actorId: input.actorId };
      const locator = await discoverGoogleDriveLibraryCoreIntentHeadV1(context);
      if (locator === null) {
        if (input.firstActorCounter !== 1)
          throw new Error("missing committed intent head");
        return {
          done: true,
          firstActorCounter: 1,
          references: [],
          previousSegmentDigest: null,
        };
      }
      guard();
      const adapter = createGoogleDriveLibraryCoreNormalizedIntentAdapterV2({
        ...context,
        ...locator,
      });
      const head = parseLibraryCoreNormalizedIntentHeadV2(
        (await adapter.readHead()).head,
      );
      if (head.latest_segment === null) {
        if (input.firstActorCounter !== 1)
          throw new Error("intent head behind native cursor");
        return {
          done: true,
          firstActorCounter: 1,
          references: [],
          previousSegmentDigest: null,
        };
      }
      guard();
      const segments =
        await discoverGoogleDriveLibraryCoreIntentSegmentsV1(context);
      const latest = segments.findIndex(
        ({ reference }) =>
          reference.transportObjectId ===
            head.latest_segment!.transportObjectId &&
          reference.descriptor.objectKey ===
            head.latest_segment!.descriptor.objectKey &&
          reference.descriptor.contentDigest ===
            head.latest_segment!.descriptor.contentDigest &&
          reference.descriptor.byteLength ===
            head.latest_segment!.descriptor.byteLength,
      );
      if (latest < 0) throw new Error("committed intent segment missing");
      let next = 1;
      for (let index = 0; index <= latest; index += 1) {
        const segment = segments[index]!;
        if (segment.firstIntentSequence !== next)
          throw new Error("intent chain gap or overlap");
        next = segment.lastIntentSequence + 1;
      }
      if (next !== head.next_actor_counter || input.firstActorCounter > next) {
        throw new Error("intent head and native cursor disagree");
      }
      const start = segments.findIndex(
        (segment, index) =>
          index <= latest &&
          segment.lastIntentSequence >= input.firstActorCounter,
      );
      const first = start < 0 ? latest + 1 : start;
      const end = Math.min(latest + 1, first + input.limit);
      return {
        done: end === latest + 1,
        firstActorCounter:
          start < 0
            ? input.firstActorCounter
            : segments[first]!.firstIntentSequence,
        references: segments
          .slice(first, end)
          .map((segment) => segment.reference),
        previousSegmentDigest:
          first === 0
            ? null
            : segments[first - 1]!.reference.descriptor.contentDigest,
      };
    },
    async openResultAdapter(input) {
      scope(input.libraryId, input.storageEpochId);
      const context = { ...options, actorId: input.actorId };
      let locator = await discoverGoogleDriveLibraryCoreResultHeadV1(context);
      if (locator === null) {
        guard();
        locator = await provisionGoogleDriveLibraryCoreNormalizedResultHeadV2({
          ...options,
          head: parseLibraryCoreNormalizedResultHeadV2({
            actor_id: input.actorId,
            library_id: input.libraryId,
            storage_epoch_id: input.storageEpochId,
            protocol: "normalized_result_head_v2",
            protocol_version: 2,
            next_result_sequence: 1,
            latest_segment: null,
            latest_segment_digest: null,
          }),
        });
      }
      guard();
      return createGoogleDriveLibraryCoreNormalizedResultAdapterV2({
        ...context,
        ...locator,
      });
    },
  };
}
