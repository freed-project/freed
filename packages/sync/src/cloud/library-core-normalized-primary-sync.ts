import {
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedResultHeadV2,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedIntentEnvelopeRecordV2,
  type LibraryCoreNormalizedResultHeadV2,
} from "@freed/shared/library-core";
import { importLibraryCoreNormalizedIntentSegmentV2 } from "./library-core-normalized-intent-segments.js";
import {
  publishLibraryCoreNormalizedResultSegmentV2,
  type LibraryCoreNormalizedHeadPublicationAdapterV2,
} from "./library-core-normalized-segment-publication.js";
import type {
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
} from "./library-core-immutable-publication.js";

const ENROLLMENT_REQUEST_PAGE_LIMIT = 16;
const INTENT_REFERENCE_PAGE_LIMIT = 16;
const RESULT_PAGE_RECORD_LIMIT = 128;
const RESULT_PAGE_RESPONSE_BYTE_LIMIT = 1_048_576;
const MAXIMUM_ENROLLMENT_BYTES = 65_536;

export interface LibraryCoreNormalizedPrimaryEnrollmentRequestV2 {
  readonly bytes: Uint8Array;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
}

export interface LibraryCoreNormalizedPrimaryEnrollmentPageV2 {
  readonly done: boolean;
  readonly requests: readonly LibraryCoreNormalizedPrimaryEnrollmentRequestV2[];
}

export interface LibraryCoreNormalizedPrimaryEnrollmentTransportV2 {
  pageEnrollmentRequests(
    input: Readonly<{
      libraryId: LibraryCoreLowercaseHex64;
      limit: number;
      storageEpochId: LibraryCoreLowercaseHex64;
    }>,
  ): Promise<LibraryCoreNormalizedPrimaryEnrollmentPageV2>;
  publishEnrollmentCertificate(
    input: Readonly<{
      certificate: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
      request: LibraryCoreImmutableObjectReferenceV1;
    }>,
  ): Promise<LibraryCoreImmutableObjectReferenceV1>;
}

export interface LibraryCoreNormalizedPrimaryEnrollmentRuntimeV2 {
  countersignEnrollment(
    input: Readonly<{
      acceptedAtMs: number;
      canonicalEnrollmentRequestJson: string;
    }>,
  ): Promise<unknown>;
  now(): number;
}

export interface LibraryCoreNormalizedPrimaryEnrollmentReceiptV2 {
  readonly done: boolean;
  readonly processedRequestCount: number;
  readonly publishedCertificates: readonly LibraryCoreImmutableObjectReferenceV1[];
}

export interface LibraryCoreNormalizedPrimaryIntentReferencePageV2 {
  readonly done: boolean;
  readonly previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly references: readonly LibraryCoreImmutableObjectReferenceV1[];
}

export interface LibraryCoreNormalizedPrimaryIntentTransportV2 {
  readonly intentReader: LibraryCoreImmutableReadAdapterV1;
  pageIntentReferences(
    input: Readonly<{
      actorId: LibraryCoreLowercaseHex64;
      firstActorCounter: number;
      libraryId: LibraryCoreLowercaseHex64;
      limit: number;
      storageEpochId: LibraryCoreLowercaseHex64;
    }>,
  ): Promise<LibraryCoreNormalizedPrimaryIntentReferencePageV2>;
}

export interface LibraryCoreNormalizedPrimaryIntentRuntimeV2 {
  ingestIntentPage(
    input: Readonly<{
      page: Readonly<{
        records: readonly LibraryCoreNormalizedPrimaryIntentStageRecordV1[];
      }>;
      receivedAt: number;
    }>,
  ): Promise<unknown>;
  now(): number;
  readActorState(actorId: LibraryCoreLowercaseHex64): Promise<unknown>;
  readonly subtle: SubtleCrypto;
}

export interface LibraryCoreNormalizedPrimaryIntentStageRecordV1 {
  readonly actorCounter: number;
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly canonicalEnvelopeJson: string;
  readonly intentEpoch: number;
  readonly intentEpochId: LibraryCoreLowercaseHex64;
  readonly memberCount: number;
  readonly memberIndex: number;
  readonly operationId: string;
  readonly state: "pending";
  readonly transactionDigest: LibraryCoreLowercaseHex64;
  readonly transactionId: string;
}

export interface LibraryCoreNormalizedPrimaryIntentReceiptV2 {
  readonly done: boolean;
  readonly importedIntentCount: number;
  readonly importedSegmentCount: number;
  readonly nextActorCounter: number;
  readonly previousSegmentDigest: LibraryCoreLowercaseHex64 | null;
}

export interface LibraryCoreNormalizedPrimaryResultPageV1 {
  readonly canonicalResults: readonly Uint8Array[];
  readonly done: boolean;
}

export interface LibraryCoreNormalizedPrimaryResultTransportV2 {
  openResultAdapter(
    input: Readonly<{
      actorId: LibraryCoreLowercaseHex64;
      libraryId: LibraryCoreLowercaseHex64;
      storageEpochId: LibraryCoreLowercaseHex64;
    }>,
  ): Promise<
    LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedResultHeadV2>
  >;
}

export interface LibraryCoreNormalizedPrimaryResultRuntimeV2 {
  exportResultPage(
    input: Readonly<{
      actorId: LibraryCoreLowercaseHex64;
      firstResultSequence: number;
      maximumRecords: number;
      maximumResponseBytes: number;
    }>,
  ): Promise<LibraryCoreNormalizedPrimaryResultPageV1>;
  readonly subtle: SubtleCrypto;
}

export interface LibraryCoreNormalizedPrimaryResultReceiptV2 {
  readonly done: boolean;
  readonly nextResultSequence: number;
  readonly publishedResultCount: number;
  readonly publishedSegment: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly recoveredPublication: boolean;
}

interface EnrollmentRequestIdentityV2 {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorPublicKey: string;
  readonly certificateDigest: LibraryCoreLowercaseHex64;
  readonly libraryId: LibraryCoreLowercaseHex64;
  readonly storageEpochId: LibraryCoreLowercaseHex64;
}

interface NativeEnrollmentReceiptV2 {
  readonly actorChainGenesis: LibraryCoreLowercaseHex64;
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly actorPublicKey: string;
  readonly authorityEpochId: LibraryCoreLowercaseHex64;
  readonly canonicalEnrollmentCertificateJson: string;
  readonly enrolledAt: number;
  readonly enrollmentCertificateDigest: LibraryCoreLowercaseHex64;
  readonly libraryId: LibraryCoreLowercaseHex64;
}

interface NativeActorTransportStateV1 {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly libraryId: LibraryCoreLowercaseHex64;
  readonly nextActorCounter: number;
  readonly storageEpochId: LibraryCoreLowercaseHex64;
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[] | null,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a plain closed record`);
  }
  if (expectedKeys !== null) {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      throw new TypeError(`${label} has unknown or missing fields`);
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactCanonicalValue(bytes: Uint8Array, label: string): unknown {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > MAXIMUM_ENROLLMENT_BYTES
  ) {
    throw new RangeError(`${label} exceeds its byte bound`);
  }
  const decoded = decodeLibraryCoreCanonicalValue(bytes, {
    maximumBytes: MAXIMUM_ENROLLMENT_BYTES,
  });
  const restored = encodeLibraryCoreCanonicalValue(
    decoded as LibraryCoreCanonicalValue,
    { maximumBytes: MAXIMUM_ENROLLMENT_BYTES },
  );
  if (
    restored.byteLength !== bytes.byteLength ||
    restored.some((byte, index) => byte !== bytes[index])
  ) {
    throw new TypeError(`${label} is not exact canonical JSON`);
  }
  return decoded;
}

function parseEnrollmentRequestIdentity(
  bytes: Uint8Array,
): EnrollmentRequestIdentityV2 {
  const request = closedRecord(
    exactCanonicalValue(bytes, "normalized enrollment request"),
    ["certificate_body", "certificate_digest"],
    "normalized enrollment request",
  );
  const certificateBody = closedRecord(
    request.certificate_body,
    ["actor_enrollment_body", "actor_proof", "enrollment_body_digest"],
    "normalized enrollment request certificate body",
  );
  const enrollmentBody = closedRecord(
    certificateBody.actor_enrollment_body,
    null,
    "normalized enrollment request actor body",
  );
  const actorId = enrollmentBody.actor_id;
  const actorPublicKey = enrollmentBody.actor_public_key;
  const libraryId = enrollmentBody.library_id;
  const storageEpochId = enrollmentBody.authority_epoch_id;
  const certificateDigest = request.certificate_digest;
  if (
    !isLibraryCoreLowercaseHex64(actorId) ||
    !isLibraryCoreEd25519PublicKeyHex(actorPublicKey) ||
    !isLibraryCoreLowercaseHex64(libraryId) ||
    !isLibraryCoreLowercaseHex64(storageEpochId) ||
    !isLibraryCoreLowercaseHex64(certificateDigest)
  ) {
    throw new TypeError("normalized enrollment request identity is invalid");
  }
  return Object.freeze({
    actorId,
    actorPublicKey,
    certificateDigest,
    libraryId,
    storageEpochId,
  });
}

function parseNativeEnrollmentReceipt(
  value: unknown,
): NativeEnrollmentReceiptV2 {
  const receipt = closedRecord(
    value,
    [
      "actorChainGenesis",
      "actorId",
      "actorPublicKey",
      "authorityEpochId",
      "canonicalEnrollmentCertificateJson",
      "enrolledAt",
      "enrollmentCertificateDigest",
      "libraryId",
    ],
    "normalized native enrollment receipt",
  );
  if (
    !isLibraryCoreLowercaseHex64(receipt.actorChainGenesis) ||
    !isLibraryCoreLowercaseHex64(receipt.actorId) ||
    !isLibraryCoreEd25519PublicKeyHex(receipt.actorPublicKey) ||
    !isLibraryCoreLowercaseHex64(receipt.authorityEpochId) ||
    typeof receipt.canonicalEnrollmentCertificateJson !== "string" ||
    !isLibraryCoreNonnegativeSafeInteger(receipt.enrolledAt) ||
    !isLibraryCoreLowercaseHex64(receipt.enrollmentCertificateDigest) ||
    !isLibraryCoreLowercaseHex64(receipt.libraryId)
  ) {
    throw new TypeError("normalized native enrollment receipt is invalid");
  }
  return Object.freeze({
    actorChainGenesis: receipt.actorChainGenesis,
    actorId: receipt.actorId,
    actorPublicKey: receipt.actorPublicKey,
    authorityEpochId: receipt.authorityEpochId,
    canonicalEnrollmentCertificateJson:
      receipt.canonicalEnrollmentCertificateJson,
    enrolledAt: receipt.enrolledAt,
    enrollmentCertificateDigest: receipt.enrollmentCertificateDigest,
    libraryId: receipt.libraryId,
  });
}

function parseNativeActorTransportState(
  value: unknown,
): NativeActorTransportStateV1 {
  const state = closedRecord(
    value,
    ["actorId", "libraryId", "nextActorCounter", "storageEpochId"],
    "normalized native actor transport state",
  );
  if (
    !isLibraryCoreLowercaseHex64(state.actorId) ||
    !isLibraryCoreLowercaseHex64(state.libraryId) ||
    !isLibraryCoreNonnegativeSafeInteger(state.nextActorCounter) ||
    state.nextActorCounter < 1 ||
    !isLibraryCoreLowercaseHex64(state.storageEpochId)
  ) {
    throw new TypeError("normalized native actor transport state is invalid");
  }
  return Object.freeze({
    actorId: state.actorId,
    libraryId: state.libraryId,
    nextActorCounter: state.nextActorCounter,
    storageEpochId: state.storageEpochId,
  });
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

function assertContextIdentity(
  identity: EnrollmentRequestIdentityV2,
  libraryId: LibraryCoreLowercaseHex64,
  storageEpochId: LibraryCoreLowercaseHex64,
): void {
  if (
    identity.libraryId !== libraryId ||
    identity.storageEpochId !== storageEpochId
  ) {
    throw new Error("normalized enrollment request authority changed");
  }
}

function assertReceiptIdentity(
  receipt: NativeEnrollmentReceiptV2,
  request: EnrollmentRequestIdentityV2,
): void {
  if (
    receipt.actorId !== request.actorId ||
    receipt.actorPublicKey !== request.actorPublicKey ||
    receipt.libraryId !== request.libraryId ||
    receipt.authorityEpochId !== request.storageEpochId ||
    receipt.enrollmentCertificateDigest !== request.certificateDigest
  ) {
    throw new Error("normalized enrollment countersignature changed identity");
  }
}

function requireContextIdentity(
  value: string,
  label: string,
): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireClock(value: number, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function stageIntentRecord(
  envelope: LibraryCoreNormalizedIntentEnvelopeRecordV2,
  canonicalEnvelope: Uint8Array,
): LibraryCoreNormalizedPrimaryIntentStageRecordV1 {
  const intentEpoch = envelope.epoch;
  if (!isLibraryCoreNonnegativeSafeInteger(intentEpoch)) {
    throw new TypeError("normalized intent epoch is invalid");
  }
  return Object.freeze({
    actorCounter: envelope.actor_sequence,
    actorId: envelope.actor_id,
    canonicalEnvelopeJson: new TextDecoder("utf-8", { fatal: true }).decode(
      canonicalEnvelope,
    ),
    intentEpoch,
    intentEpochId: envelope.epoch_id,
    memberCount: envelope.transaction_member_count,
    memberIndex: envelope.transaction_member_index,
    operationId: envelope.operation_id,
    state: "pending",
    transactionDigest: envelope.transaction_digest,
    transactionId: envelope.transaction_id,
  });
}

/**
 * Process one bounded, transport-neutral page of follower enrollment requests.
 *
 * The transport locates immutable objects. This coordinator verifies exact
 * bytes, delegates authority signing to native SQLite, and publishes only the
 * resulting immutable certificate. It owns no provider client or retry loop.
 */
export async function syncLibraryCoreNormalizedPrimaryEnrollmentsV2(
  transport: LibraryCoreNormalizedPrimaryEnrollmentTransportV2,
  runtime: LibraryCoreNormalizedPrimaryEnrollmentRuntimeV2,
  context: Readonly<{ libraryId: string; storageEpochId: string }>,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<LibraryCoreNormalizedPrimaryEnrollmentReceiptV2> {
  const libraryId = requireContextIdentity(context.libraryId, "libraryId");
  const storageEpochId = requireContextIdentity(
    context.storageEpochId,
    "storageEpochId",
  );
  options.signal?.throwIfAborted();
  const page = await transport.pageEnrollmentRequests({
    libraryId,
    limit: ENROLLMENT_REQUEST_PAGE_LIMIT,
    storageEpochId,
  });
  if (
    typeof page.done !== "boolean" ||
    !Array.isArray(page.requests) ||
    page.requests.length > ENROLLMENT_REQUEST_PAGE_LIMIT ||
    (page.requests.length === 0 && !page.done)
  ) {
    throw new TypeError("normalized enrollment request page is invalid");
  }
  const publishedCertificates: LibraryCoreImmutableObjectReferenceV1[] = [];
  for (const candidate of page.requests) {
    options.signal?.throwIfAborted();
    const reference = parseLibraryCoreImmutableObjectReferenceV1(
      candidate.reference,
    );
    const bytes = new Uint8Array(candidate.bytes);
    if (
      bytes.byteLength !== reference.descriptor.byteLength ||
      sha256LowerHex(bytes) !== reference.descriptor.contentDigest
    ) {
      throw new Error("normalized enrollment request bytes changed");
    }
    const identity = parseEnrollmentRequestIdentity(bytes);
    assertContextIdentity(identity, libraryId, storageEpochId);
    const expectedObjectKey = createLibraryCoreImmutableObjectKey({
      actorId: identity.actorId,
      digest: reference.descriptor.contentDigest,
      epochId: storageEpochId,
      kind: "actor_enrollment_request",
      libraryId,
    });
    if (reference.descriptor.objectKey !== expectedObjectKey) {
      throw new Error("normalized enrollment request object key changed");
    }
    const acceptedAtMs = runtime.now();
    if (!isLibraryCoreNonnegativeSafeInteger(acceptedAtMs)) {
      throw new TypeError("normalized enrollment clock is invalid");
    }
    const canonicalRequestJson = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
    const receipt = parseNativeEnrollmentReceipt(
      await runtime.countersignEnrollment({
        acceptedAtMs,
        canonicalEnrollmentRequestJson: canonicalRequestJson,
      }),
    );
    assertReceiptIdentity(receipt, identity);
    const certificateBytes = new TextEncoder().encode(
      receipt.canonicalEnrollmentCertificateJson,
    );
    exactCanonicalValue(certificateBytes, "normalized enrollment certificate");
    const certificateDigest = sha256LowerHex(certificateBytes);
    const certificate: LibraryCorePreparedImmutableObjectV1<Uint8Array> =
      Object.freeze({
        descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
          byteLength: certificateBytes.byteLength,
          contentDigest: certificateDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            actorId: identity.actorId,
            digest: certificateDigest,
            epochId: storageEpochId,
            kind: "actor_enrollment",
            libraryId,
          }),
        }),
        source: certificateBytes,
      });
    const published = parseLibraryCoreImmutableObjectReferenceV1(
      await transport.publishEnrollmentCertificate({
        certificate,
        request: reference,
      }),
    );
    if (!sameDescriptor(published.descriptor, certificate.descriptor)) {
      throw new Error("normalized enrollment publication changed descriptor");
    }
    publishedCertificates.push(published);
  }
  return Object.freeze({
    done: page.done,
    processedRequestCount: page.requests.length,
    publishedCertificates: Object.freeze(publishedCertificates),
  });
}

/**
 * Import one bounded page of immutable follower intent segments into Primary
 * SQLite. The transport only discovers and reads immutable objects. Exact
 * canonical envelopes, actor sequence, segment continuity, and post-ingest
 * native state are verified before the next segment is accepted.
 */
export async function syncLibraryCoreNormalizedPrimaryIntentsV2(
  transport: LibraryCoreNormalizedPrimaryIntentTransportV2,
  runtime: LibraryCoreNormalizedPrimaryIntentRuntimeV2,
  context: Readonly<{
    actorId: string;
    libraryId: string;
    storageEpochId: string;
  }>,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<LibraryCoreNormalizedPrimaryIntentReceiptV2> {
  const actorId = requireContextIdentity(context.actorId, "actorId");
  const libraryId = requireContextIdentity(context.libraryId, "libraryId");
  const storageEpochId = requireContextIdentity(
    context.storageEpochId,
    "storageEpochId",
  );
  options.signal?.throwIfAborted();
  let actorState = parseNativeActorTransportState(
    await runtime.readActorState(actorId),
  );
  if (
    actorState.actorId !== actorId ||
    actorState.libraryId !== libraryId ||
    actorState.storageEpochId !== storageEpochId
  ) {
    throw new Error("normalized intent actor authority changed");
  }
  const page = await transport.pageIntentReferences({
    actorId,
    firstActorCounter: actorState.nextActorCounter,
    libraryId,
    limit: INTENT_REFERENCE_PAGE_LIMIT,
    storageEpochId,
  });
  if (
    typeof page.done !== "boolean" ||
    !Array.isArray(page.references) ||
    page.references.length > INTENT_REFERENCE_PAGE_LIMIT ||
    (page.references.length === 0 && !page.done) ||
    (page.previousSegmentDigest !== null &&
      !isLibraryCoreLowercaseHex64(page.previousSegmentDigest)) ||
    (actorState.nextActorCounter === 1) !==
      (page.previousSegmentDigest === null)
  ) {
    throw new TypeError("normalized intent reference page is invalid");
  }
  let previousSegmentDigest = page.previousSegmentDigest;
  let importedIntentCount = 0;
  let importedSegmentCount = 0;
  for (const rawReference of page.references) {
    options.signal?.throwIfAborted();
    const reference = parseLibraryCoreImmutableObjectReferenceV1(rawReference);
    const expectedFirstActorCounter = actorState.nextActorCounter;
    let segmentLastActorCounter: number | null = null;
    await importLibraryCoreNormalizedIntentSegmentV2({
      actorId,
      adapter: transport.intentReader,
      expectedFirstActorCounter,
      expectedPreviousSegmentDigest: previousSegmentDigest,
      libraryId,
      reference,
      storageEpochId,
      subtle: runtime.subtle,
      writer: {
        async stageNormalizedIntentSegment(input): Promise<void> {
          const records = input.envelopes.map((envelope, index) =>
            stageIntentRecord(envelope, input.canonicalEnvelopes[index]!),
          );
          await runtime.ingestIntentPage({
            page: Object.freeze({ records: Object.freeze(records) }),
            receivedAt: requireClock(
              runtime.now(),
              "normalized intent receipt clock",
            ),
          });
          segmentLastActorCounter = input.header.last_actor_counter;
          importedIntentCount += records.length;
        },
      },
    });
    if (segmentLastActorCounter === null) {
      throw new Error("normalized intent segment was not staged");
    }
    actorState = parseNativeActorTransportState(
      await runtime.readActorState(actorId),
    );
    if (
      actorState.actorId !== actorId ||
      actorState.libraryId !== libraryId ||
      actorState.storageEpochId !== storageEpochId ||
      actorState.nextActorCounter !== segmentLastActorCounter + 1
    ) {
      throw new Error("normalized intent native state did not advance exactly");
    }
    previousSegmentDigest = reference.descriptor.contentDigest;
    importedSegmentCount += 1;
  }
  return Object.freeze({
    done: page.done,
    importedIntentCount,
    importedSegmentCount,
    nextActorCounter: actorState.nextActorCounter,
    previousSegmentDigest,
  });
}

/**
 * Publish one bounded native result page through a transport-neutral actor
 * head. The runtime exports canonical SQLite results for the exact remote
 * sequence. The transport publishes one immutable segment and commits its
 * head with compare and swap plus readback recovery.
 */
export async function syncLibraryCoreNormalizedPrimaryResultsV2(
  transport: LibraryCoreNormalizedPrimaryResultTransportV2,
  runtime: LibraryCoreNormalizedPrimaryResultRuntimeV2,
  context: Readonly<{
    actorId: string;
    libraryId: string;
    storageEpochId: string;
  }>,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<LibraryCoreNormalizedPrimaryResultReceiptV2> {
  const actorId = requireContextIdentity(context.actorId, "actorId");
  const libraryId = requireContextIdentity(context.libraryId, "libraryId");
  const storageEpochId = requireContextIdentity(
    context.storageEpochId,
    "storageEpochId",
  );
  options.signal?.throwIfAborted();
  const adapter = await transport.openResultAdapter({
    actorId,
    libraryId,
    storageEpochId,
  });
  const headRead = await adapter.readHead();
  const head = parseLibraryCoreNormalizedResultHeadV2(headRead.head);
  const canonicalHeadBytes = encodeLibraryCoreCanonicalValue(
    head as unknown as LibraryCoreCanonicalValue,
  );
  if (
    !equalBytes(canonicalHeadBytes, headRead.bytes) ||
    String(head.actor_id) !== actorId ||
    String(head.library_id) !== libraryId ||
    String(head.storage_epoch_id) !== storageEpochId
  ) {
    throw new Error("normalized result head authority changed");
  }
  options.signal?.throwIfAborted();
  const page = await runtime.exportResultPage({
    actorId,
    firstResultSequence: head.next_result_sequence,
    maximumRecords: RESULT_PAGE_RECORD_LIMIT,
    maximumResponseBytes: RESULT_PAGE_RESPONSE_BYTE_LIMIT,
  });
  if (
    typeof page.done !== "boolean" ||
    !Array.isArray(page.canonicalResults) ||
    page.canonicalResults.length > RESULT_PAGE_RECORD_LIMIT ||
    (page.canonicalResults.length === 0 && !page.done) ||
    page.canonicalResults.some((bytes) => !(bytes instanceof Uint8Array))
  ) {
    throw new TypeError("normalized result page is invalid");
  }
  if (page.canonicalResults.length === 0) {
    return Object.freeze({
      done: true,
      nextResultSequence: head.next_result_sequence,
      publishedResultCount: 0,
      publishedSegment: null,
      recoveredPublication: false,
    });
  }
  options.signal?.throwIfAborted();
  const published = await publishLibraryCoreNormalizedResultSegmentV2({
    adapter,
    canonicalResults: page.canonicalResults.map((bytes) => bytes.slice()),
    subtle: runtime.subtle,
  });
  return Object.freeze({
    done: page.done,
    nextResultSequence: published.publishedHead.next_result_sequence,
    publishedResultCount: page.canonicalResults.length,
    publishedSegment: published.segmentReference,
    recoveredPublication: published.status === "recovered_after_response_loss",
  });
}
