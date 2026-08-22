import {
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedIntentHeadV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreFollowerTransportContextV2,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedIntentHeadV2,
} from "@freed/shared/library-core";
import {
  importLibraryCoreNormalizedIntentSegmentV2,
  importLibraryCoreNormalizedResultSegmentV2,
  publishLibraryCoreNormalizedIntentSegmentV2,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCoreNormalizedHeadPublicationAdapterV2,
} from "@freed/sync/cloud/library-core";
import {
  installPwaLibraryCoreFollowerEnrollment,
  preparePwaLibraryCoreFollowerEnrollment,
  type PwaLibraryCoreFollowerEnrollmentCandidateV2,
} from "./library-core-pwa-follower-enrollment";
import {
  importPwaNormalizedFollowerResultTransport,
  pagePwaFollowerTransport,
  publishPwaNormalizedFollowerIntentTransport,
  readPwaFollowerTransportContext,
} from "./library-core-sqlite-runtime";

const RESULT_REFERENCE_PAGE_LIMIT = 16;

export interface PwaLibraryCoreFollowerResultReferencePageV2 {
  readonly done: boolean;
  readonly references: readonly LibraryCoreImmutableObjectReferenceV1[];
}

export interface PwaLibraryCoreFollowerTransportV2 {
  publishEnrollmentRequest(
    candidate: PwaLibraryCoreFollowerEnrollmentCandidateV2,
  ): Promise<LibraryCoreImmutableObjectReferenceV1>;
  readEnrollmentCertificate(
    input: Readonly<{
      actorId: LibraryCoreLowercaseHex64;
      enrollmentRequestDigest: LibraryCoreLowercaseHex64;
      libraryId: LibraryCoreLowercaseHex64;
      storageEpochId: LibraryCoreLowercaseHex64;
    }>,
  ): Promise<Uint8Array | null>;
  openIntentAdapter(
    context: LibraryCoreFollowerTransportContextV2,
  ): Promise<
    LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedIntentHeadV2> &
      LibraryCoreImmutableReadAdapterV1
  >;
  pageResultReferences(
    input: Readonly<{
      actorId: LibraryCoreLowercaseHex64;
      firstResultSequence: number;
      libraryId: LibraryCoreLowercaseHex64;
      limit: number;
      previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
      storageEpochId: LibraryCoreLowercaseHex64;
    }>,
  ): Promise<PwaLibraryCoreFollowerResultReferencePageV2>;
  readonly resultReader: LibraryCoreImmutableReadAdapterV1;
}

export interface PwaLibraryCoreFollowerSyncRuntime {
  readonly importResult: typeof importPwaNormalizedFollowerResultTransport;
  readonly installEnrollment: typeof installPwaLibraryCoreFollowerEnrollment;
  readonly now: () => number;
  readonly pageIntents: typeof pagePwaFollowerTransport;
  readonly prepareEnrollment: typeof preparePwaLibraryCoreFollowerEnrollment;
  readonly publishIntent: typeof publishPwaNormalizedFollowerIntentTransport;
  readonly readContext: typeof readPwaFollowerTransportContext;
  readonly subtle: SubtleCrypto;
}

function defaultRuntime(): PwaLibraryCoreFollowerSyncRuntime {
  return Object.freeze({
    importResult: importPwaNormalizedFollowerResultTransport,
    installEnrollment: installPwaLibraryCoreFollowerEnrollment,
    now: Date.now,
    pageIntents: pagePwaFollowerTransport,
    prepareEnrollment: preparePwaLibraryCoreFollowerEnrollment,
    publishIntent: publishPwaNormalizedFollowerIntentTransport,
    readContext: readPwaFollowerTransportContext,
    subtle: crypto.subtle,
  });
}

export interface PwaLibraryCoreFollowerSyncReceiptV2 {
  readonly enrollmentState: "enrolled" | "pending";
  readonly importedResultCount: number;
  readonly publishedIntentCount: number;
  readonly recoveredIntentPublication: boolean;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function sameDescriptor(
  left: LibraryCoreImmutableObjectReferenceV1["descriptor"],
  right: LibraryCoreImmutableObjectReferenceV1["descriptor"],
): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.contentDigest === right.contentDigest &&
    left.objectKey === right.objectKey
  );
}

function exactIntentHead(
  value: LibraryCoreNormalizedIntentHeadV2,
  bytes: Uint8Array,
): LibraryCoreNormalizedIntentHeadV2 {
  const parsed = parseLibraryCoreNormalizedIntentHeadV2(value);
  const expected = encodeLibraryCoreCanonicalValue(
    parsed as unknown as LibraryCoreCanonicalValue,
  );
  if (
    expected.byteLength !== bytes.byteLength ||
    expected.some((byte, index) => byte !== bytes[index])
  ) {
    throw new Error("normalized intent head is not exact canonical JSON");
  }
  return parsed;
}

async function ensureEnrollment(
  transport: PwaLibraryCoreFollowerTransportV2,
  runtime: PwaLibraryCoreFollowerSyncRuntime,
  signal: AbortSignal | undefined,
): Promise<"enrolled" | "pending"> {
  throwIfAborted(signal);
  const candidate = await runtime.prepareEnrollment();
  if (candidate === null) return "enrolled";
  const published = parseLibraryCoreImmutableObjectReferenceV1(
    await transport.publishEnrollmentRequest(candidate),
  );
  if (!sameDescriptor(published.descriptor, candidate.descriptor)) {
    throw new Error("follower enrollment publication changed its descriptor");
  }
  throwIfAborted(signal);
  const certificate = await transport.readEnrollmentCertificate({
    actorId: candidate.receipt.actorId,
    enrollmentRequestDigest: candidate.receipt.enrollmentRequestDigest,
    libraryId: candidate.libraryId,
    storageEpochId: candidate.storageEpochId,
  });
  if (certificate === null) return "pending";
  await runtime.installEnrollment({
    canonicalCertificateBytes: certificate,
    enrolledAt: runtime.now(),
  });
  return "enrolled";
}

function assertHeadIdentity(
  head: LibraryCoreNormalizedIntentHeadV2,
  context: LibraryCoreFollowerTransportContextV2,
): void {
  if (
    head.actor_id !== context.actorId ||
    head.library_id !== context.libraryId ||
    head.storage_epoch_id !== context.storageEpochId
  ) {
    throw new Error("normalized intent transport authority changed");
  }
}

async function reconcileOrPublishIntents(
  transport: PwaLibraryCoreFollowerTransportV2,
  runtime: PwaLibraryCoreFollowerSyncRuntime,
  context: LibraryCoreFollowerTransportContextV2,
  signal: AbortSignal | undefined,
): Promise<Readonly<{ count: number; recovered: boolean }>> {
  const adapter = await transport.openIntentAdapter(context);
  const remote = await adapter.readHead();
  const head = exactIntentHead(remote.head, remote.bytes);
  assertHeadIdentity(head, context);
  if (head.next_actor_counter < context.nextIntentActorCounter) {
    throw new Error("normalized intent transport is behind SQLite authority");
  }
  if (head.next_actor_counter > context.nextIntentActorCounter) {
    if (head.latest_segment === null) {
      throw new Error("normalized intent recovery segment is unavailable");
    }
    let recoveredCount = 0;
    await importLibraryCoreNormalizedIntentSegmentV2({
      actorId: context.actorId,
      adapter,
      expectedFirstActorCounter: context.nextIntentActorCounter,
      expectedPreviousSegmentDigest: context.previousIntentSegmentDigest,
      libraryId: context.libraryId,
      reference: head.latest_segment,
      storageEpochId: context.storageEpochId,
      subtle: runtime.subtle,
      writer: {
        async stageNormalizedIntentSegment(input) {
          const receipt = await runtime.publishIntent({
            header: input.header,
            publishedAt: runtime.now(),
            reference: input.reference,
          });
          recoveredCount =
            receipt.lastActorCounter - receipt.firstActorCounter + 1;
        },
      },
    });
    if (
      head.next_actor_counter !==
      context.nextIntentActorCounter + recoveredCount
    ) {
      throw new Error(
        "normalized intent recovery crossed more than one segment",
      );
    }
    return Object.freeze({ count: recoveredCount, recovered: true });
  }
  if (head.latest_segment_digest !== context.previousIntentSegmentDigest) {
    throw new Error("normalized intent chain digest changed");
  }
  throwIfAborted(signal);
  const page = await runtime.pageIntents({
    actorId: context.actorId,
    firstActorCounter: context.nextIntentActorCounter,
    limit: 128,
    schemaVersion: 2,
  });
  if (page.canonicalEnvelopes.length === 0) {
    return Object.freeze({ count: 0, recovered: false });
  }
  const publishedAt = runtime.now();
  const published = await publishLibraryCoreNormalizedIntentSegmentV2({
    adapter,
    canonicalEnvelopes: page.canonicalEnvelopes,
    subtle: runtime.subtle,
  });
  await runtime.publishIntent({
    header: published.segmentHeader,
    publishedAt,
    reference: published.segmentReference,
  });
  return Object.freeze({
    count: page.canonicalEnvelopes.length,
    recovered: published.status === "recovered_after_response_loss",
  });
}

async function importResults(
  transport: PwaLibraryCoreFollowerTransportV2,
  runtime: PwaLibraryCoreFollowerSyncRuntime,
  context: LibraryCoreFollowerTransportContextV2,
  signal: AbortSignal | undefined,
): Promise<number> {
  const page = await transport.pageResultReferences({
    actorId: context.actorId,
    firstResultSequence: context.nextResultSequence,
    libraryId: context.libraryId,
    limit: RESULT_REFERENCE_PAGE_LIMIT,
    previousSegmentDigest: context.previousResultSegmentDigest,
    storageEpochId: context.storageEpochId,
  });
  if (
    page.references.length > RESULT_REFERENCE_PAGE_LIMIT ||
    (page.references.length === 0 && !page.done)
  ) {
    throw new Error("normalized result reference page is invalid");
  }
  let expectedFirst = context.nextResultSequence;
  let expectedPrevious = context.previousResultSegmentDigest;
  let importedCount = 0;
  for (const rawReference of page.references) {
    throwIfAborted(signal);
    const reference = parseLibraryCoreImmutableObjectReferenceV1(rawReference);
    await importLibraryCoreNormalizedResultSegmentV2({
      actorId: context.actorId,
      adapter: transport.resultReader,
      expectedFirstResultSequence: expectedFirst,
      expectedPreviousSegmentDigest: expectedPrevious,
      libraryId: context.libraryId,
      reference,
      storageEpochId: context.storageEpochId,
      subtle: runtime.subtle,
      writer: {
        async appendNormalizedResultSegment(input) {
          const receipt = await runtime.importResult({
            header: input.header,
            receivedAt: runtime.now(),
            reference: input.reference,
            results: input.results,
          });
          importedCount += receipt.resultCount;
          expectedFirst = receipt.nextResultSequence;
          expectedPrevious = receipt.storedSegmentDigest;
        },
      },
    });
  }
  return importedCount;
}

export async function syncPwaLibraryCoreFollowerV2(
  transport: PwaLibraryCoreFollowerTransportV2,
  options: Readonly<{ signal?: AbortSignal }> = {},
  runtime: PwaLibraryCoreFollowerSyncRuntime = defaultRuntime(),
): Promise<PwaLibraryCoreFollowerSyncReceiptV2> {
  const enrollmentState = await ensureEnrollment(
    transport,
    runtime,
    options.signal,
  );
  if (enrollmentState === "pending") {
    return Object.freeze({
      enrollmentState,
      importedResultCount: 0,
      publishedIntentCount: 0,
      recoveredIntentPublication: false,
    });
  }
  const context = await runtime.readContext();
  const intents = await reconcileOrPublishIntents(
    transport,
    runtime,
    context,
    options.signal,
  );
  const refreshed = await runtime.readContext();
  const importedResultCount = await importResults(
    transport,
    runtime,
    refreshed,
    options.signal,
  );
  return Object.freeze({
    enrollmentState,
    importedResultCount,
    publishedIntentCount: intents.count,
    recoveredIntentPublication: intents.recovered,
  });
}
