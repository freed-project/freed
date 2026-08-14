import {
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreResultHeadV1,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreResultHeadV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCoreImmutableReadAdapterV1,
} from "./library-core-immutable-publication.js";
import {
  prepareLibraryCoreResultSegmentV1,
  type LibraryCoreResultOutboxEntryV1,
} from "./library-core-result-segments.js";

export interface LibraryCoreResultHeadReadV1 {
  readonly bytes: Uint8Array;
  readonly head: LibraryCoreResultHeadV1;
  readonly revision: string;
}

export interface LibraryCoreResultPublicationAdapterV1
  extends LibraryCoreImmutablePublicationAdapterV1<Uint8Array>,
    LibraryCoreImmutableReadAdapterV1 {
  readResultHead(): Promise<LibraryCoreResultHeadReadV1>;
  compareAndSwapResultHead(input: {
    readonly bytes: Uint8Array;
    readonly expectedRevision: string;
  }): Promise<Readonly<{ status: "committed" }> | Readonly<{
    current: LibraryCoreResultHeadReadV1;
    status: "conflict";
  }>>;
}

function headBytes(head: LibraryCoreResultHeadV1): Uint8Array {
  return encodeLibraryCoreCanonicalValue(head as unknown as LibraryCoreCanonicalValue);
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export async function publishLibraryCoreResultEntriesV1(input: {
  readonly adapter: LibraryCoreResultPublicationAdapterV1;
  readonly entries: readonly LibraryCoreResultOutboxEntryV1[];
  readonly subtle: SubtleCrypto;
}): Promise<Readonly<{
  readonly publishedHead: LibraryCoreResultHeadV1;
  readonly segmentReference: LibraryCoreImmutableObjectReferenceV1;
  readonly status: "committed" | "recovered_after_response_loss";
}>> {
  const initial = await input.adapter.readResultHead();
  const expected = parseLibraryCoreResultHeadV1(initial.head);
  const first = input.entries[0];
  if (!first || first.resultSequence !== expected.next_result_sequence) {
    throw new Error("result publication does not extend the exact actor head");
  }
  const prepared = await prepareLibraryCoreResultSegmentV1({
    actorId: expected.actor_id,
    entries: input.entries,
    epochId: expected.epoch_id,
    libraryId: expected.library_id,
    previousSegmentDigest: expected.latest_segment_digest,
    subtle: input.subtle,
  });
  const stored = await input.adapter.putImmutable(prepared.object);
  const descriptor = await input.adapter.verifyImmutable({
    descriptor: prepared.object.descriptor,
    transportObjectId: stored.transportObjectId,
  });
  const segmentReference = parseLibraryCoreImmutableObjectReferenceV1({
    descriptor,
    transportObjectId: stored.transportObjectId,
  });
  const publishedHead = parseLibraryCoreResultHeadV1({
    actor_id: expected.actor_id,
    epoch_id: expected.epoch_id,
    latest_segment: segmentReference,
    latest_segment_digest: segmentReference.descriptor.contentDigest,
    library_id: expected.library_id,
    next_result_sequence: prepared.header.last_result_sequence + 1,
    protocol: "result_head_v1",
    protocol_version: 1,
    schema_version: 1,
  });
  const bytes = headBytes(publishedHead);
  let status: "committed" | "recovered_after_response_loss" = "committed";
  try {
    const result = await input.adapter.compareAndSwapResultHead({
      bytes,
      expectedRevision: initial.revision,
    });
    if (result.status === "conflict") {
      if (!equal(result.current.bytes, bytes)) throw new Error("result head changed concurrently");
      status = "recovered_after_response_loss";
    }
  } catch (error) {
    const readBack = await input.adapter.readResultHead();
    if (!equal(readBack.bytes, bytes)) throw error;
    status = "recovered_after_response_loss";
  }
  const readBack = await input.adapter.readResultHead();
  if (!equal(readBack.bytes, bytes) || sha256LowerHex(readBack.bytes) !== sha256LowerHex(bytes)) {
    throw new Error("result head readback did not match committed bytes");
  }
  return Object.freeze({ publishedHead, segmentReference, status });
}
