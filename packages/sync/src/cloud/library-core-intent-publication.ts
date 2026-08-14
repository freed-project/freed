import {
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreIntentHeadV1,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreIntentHeadV1,
  type LibraryCoreIntentSegmentBodyV1,
  type LibraryCoreIntentSegmentEntryV1,
  type LibraryCoreIntentSegmentHeaderV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";

import type {
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCoreImmutableReadAdapterV1,
} from "./library-core-immutable-publication.js";
import { prepareLibraryCoreIntentSegmentV1 } from "./library-core-intent-segments.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

export interface LibraryCoreIntentHeadReadV1 {
  readonly bytes: Uint8Array;
  readonly head: LibraryCoreIntentHeadV1;
  readonly revision: string;
}

export type LibraryCoreIntentHeadCompareAndSwapResultV1 =
  | Readonly<{ readonly status: "committed" }>
  | Readonly<{
      readonly status: "conflict";
      readonly current: LibraryCoreIntentHeadReadV1;
    }>;

export interface LibraryCoreIntentPublicationAdapterV1
  extends LibraryCoreImmutablePublicationAdapterV1<Uint8Array>,
    LibraryCoreImmutableReadAdapterV1 {
  readIntentHead(): Promise<LibraryCoreIntentHeadReadV1>;
  compareAndSwapIntentHead(input: {
    readonly bytes: Uint8Array;
    readonly expectedRevision: string;
  }): Promise<LibraryCoreIntentHeadCompareAndSwapResultV1>;
}

export interface LibraryCoreIntentPublicationCandidateV1 {
  readonly body: LibraryCoreIntentSegmentBodyV1;
  readonly expectedHead: LibraryCoreIntentHeadV1;
  readonly expectedHeadDigest: LibraryCoreLowercaseHex64;
}

export type LibraryCoreIntentPublicationResultV1 =
  | Readonly<{
      readonly entries: readonly LibraryCoreIntentSegmentEntryV1[];
      readonly expectedHeadDigest: LibraryCoreLowercaseHex64;
      readonly header: LibraryCoreIntentSegmentHeaderV1;
      readonly publishedHead: LibraryCoreIntentHeadV1;
      readonly readBackHeadDigest: LibraryCoreLowercaseHex64;
      readonly segmentReference: LibraryCoreImmutableObjectReferenceV1;
      readonly status: "committed" | "recovered_after_response_loss";
    }>
  | Readonly<{
      readonly current: LibraryCoreIntentHeadReadV1;
      readonly status: "conflict";
    }>;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function headBytes(head: LibraryCoreIntentHeadV1): Uint8Array {
  return encodeLibraryCoreCanonicalValue(
    head as unknown as LibraryCoreCanonicalValue,
  );
}

function headDigest(bytes: Uint8Array): LibraryCoreLowercaseHex64 {
  return sha256LowerHex(bytes);
}

function canonicalEnvelopeJson(entry: LibraryCoreIntentSegmentEntryV1): string {
  return textDecoder.decode(
    encodeLibraryCoreCanonicalValue(
      entry.canonical_envelope as LibraryCoreCanonicalValue,
    ),
  );
}

function nextIntentHead(
  body: LibraryCoreIntentSegmentBodyV1,
  reference: LibraryCoreImmutableObjectReferenceV1,
): LibraryCoreIntentHeadV1 {
  return parseLibraryCoreIntentHeadV1({
    actor_id: body.actor_id,
    epoch_id: body.epoch_id,
    latest_segment: reference,
    latest_segment_digest: reference.descriptor.contentDigest,
    library_id: body.library_id,
    next_intent_sequence: body.last_intent_sequence + 1,
    protocol: "intent_head_v1",
    protocol_version: 1,
    schema_version: body.schema_version,
  });
}

/**
 * Publish one complete durable PWA intent range.
 *
 * Immutable bytes are uploaded and verified before the actor head advances.
 * A lost compare-and-swap response is recovered only when exact readback
 * proves that the intended head committed.
 */
export async function publishLibraryCoreIntentCandidateV1(input: {
  readonly adapter: LibraryCoreIntentPublicationAdapterV1;
  readonly candidate: LibraryCoreIntentPublicationCandidateV1;
  readonly subtle: SubtleCrypto;
}): Promise<LibraryCoreIntentPublicationResultV1> {
  const expectedHead = parseLibraryCoreIntentHeadV1(
    input.candidate.expectedHead,
  );
  const expectedHeadBytes = headBytes(expectedHead);
  if (
    headDigest(expectedHeadBytes) !== input.candidate.expectedHeadDigest
  ) {
    throw new TypeError("intent candidate expected-head digest is invalid");
  }

  const initial = await input.adapter.readIntentHead();
  if (!bytesEqual(initial.bytes, expectedHeadBytes)) {
    return Object.freeze({ current: initial, status: "conflict" });
  }

  const prepared = await prepareLibraryCoreIntentSegmentV1({
    actorId: input.candidate.body.actor_id,
    entries: input.candidate.body.entries.map((entry) => ({
      canonicalEnvelopeJson: canonicalEnvelopeJson(entry),
      intentSequence: entry.intent_sequence,
      operationId: entry.operation_id,
    })),
    epochId: input.candidate.body.epoch_id,
    libraryId: input.candidate.body.library_id,
    previousSegmentDigest: input.candidate.body.previous_segment_digest,
    schemaVersion: input.candidate.body.schema_version,
    subtle: input.subtle,
  });
  if (
    !bytesEqual(
      encodeLibraryCoreCanonicalValue(
        prepared.body as unknown as LibraryCoreCanonicalValue,
      ),
      encodeLibraryCoreCanonicalValue(
        input.candidate.body as unknown as LibraryCoreCanonicalValue,
      ),
    )
  ) {
    throw new TypeError("prepared intent segment changed the durable body");
  }

  const stored = await input.adapter.putImmutable(prepared.object);
  const descriptor = await input.adapter.verifyImmutable({
    descriptor: prepared.object.descriptor,
    transportObjectId: stored.transportObjectId,
  });
  const segmentReference = parseLibraryCoreImmutableObjectReferenceV1({
    descriptor,
    transportObjectId: stored.transportObjectId,
  });
  const publishedHead = nextIntentHead(prepared.body, segmentReference);
  const publishedBytes = headBytes(publishedHead);
  let status: "committed" | "recovered_after_response_loss" = "committed";
  try {
    const result = await input.adapter.compareAndSwapIntentHead({
      bytes: publishedBytes,
      expectedRevision: initial.revision,
    });
    if (result.status === "conflict") {
      if (!bytesEqual(result.current.bytes, publishedBytes)) {
        return Object.freeze({ current: result.current, status: "conflict" });
      }
      status = "recovered_after_response_loss";
    }
  } catch (error) {
    const readBack = await input.adapter.readIntentHead();
    if (!bytesEqual(readBack.bytes, publishedBytes)) throw error;
    status = "recovered_after_response_loss";
  }

  const readBack = await input.adapter.readIntentHead();
  if (!bytesEqual(readBack.bytes, publishedBytes)) {
    throw new Error("intent head readback did not match the committed bytes");
  }
  return Object.freeze({
    entries: prepared.body.entries,
    expectedHeadDigest: input.candidate.expectedHeadDigest,
    header: prepared.header,
    publishedHead,
    readBackHeadDigest: headDigest(readBack.bytes),
    segmentReference,
    status,
  });
}
