import {
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedIntentHeadV2,
  parseLibraryCoreNormalizedResultHeadV2,
  sha256LowerHex,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreNormalizedIntentHeadV2,
  type LibraryCoreNormalizedResultHeadV2,
} from "@freed/shared/library-core";
import type { LibraryCoreImmutablePublicationAdapterV1 } from "./library-core-immutable-publication.js";
import { prepareLibraryCoreNormalizedIntentSegmentV2 } from "./library-core-normalized-intent-segments.js";
import { prepareLibraryCoreNormalizedResultSegmentV2 } from "./library-core-normalized-result-segments.js";

type LibraryCoreNormalizedHeadV2 =
  | LibraryCoreNormalizedIntentHeadV2
  | LibraryCoreNormalizedResultHeadV2;

export interface LibraryCoreNormalizedHeadReadV2<
  Head extends LibraryCoreNormalizedHeadV2,
> {
  readonly bytes: Uint8Array;
  readonly head: Head;
  readonly revision: string;
}

export type LibraryCoreNormalizedHeadPublicationAdapterV2<
  Head extends LibraryCoreNormalizedHeadV2,
> = Pick<
  LibraryCoreImmutablePublicationAdapterV1<Uint8Array>,
  "putImmutable" | "verifyImmutable"
> & {
  readHead(): Promise<LibraryCoreNormalizedHeadReadV2<Head>>;
  compareAndSwapHead(input: {
    readonly bytes: Uint8Array;
    readonly expectedRevision: string;
  }): Promise<
    | Readonly<{ status: "committed" }>
    | Readonly<{
        current: LibraryCoreNormalizedHeadReadV2<Head>;
        status: "conflict";
      }>
  >;
};

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function headBytes(head: LibraryCoreNormalizedHeadV2): Uint8Array {
  return encodeLibraryCoreCanonicalValue(
    head as unknown as LibraryCoreCanonicalValue,
  );
}

async function commitNormalizedHeadV2<Head extends LibraryCoreNormalizedHeadV2>(
  input: {
    readonly adapter: LibraryCoreNormalizedHeadPublicationAdapterV2<Head>;
    readonly expected: LibraryCoreNormalizedHeadReadV2<Head>;
    readonly next: Head;
  },
): Promise<"committed" | "recovered_after_response_loss"> {
  const bytes = headBytes(input.next);
  let status: "committed" | "recovered_after_response_loss" = "committed";
  try {
    const result = await input.adapter.compareAndSwapHead({
      bytes,
      expectedRevision: input.expected.revision,
    });
    if (result.status === "conflict") {
      if (!equal(result.current.bytes, bytes)) {
        throw new Error("normalized segment head changed concurrently");
      }
      status = "recovered_after_response_loss";
    }
  } catch (error) {
    const readBack = await input.adapter.readHead();
    if (!equal(readBack.bytes, bytes)) throw error;
    status = "recovered_after_response_loss";
  }
  const readBack = await input.adapter.readHead();
  if (
    !equal(readBack.bytes, bytes) ||
    sha256LowerHex(readBack.bytes) !== sha256LowerHex(bytes)
  ) {
    throw new Error("normalized segment head readback changed");
  }
  return status;
}

async function publishImmutableSegmentV2<Head extends LibraryCoreNormalizedHeadV2>(
  input: {
    readonly adapter: LibraryCoreNormalizedHeadPublicationAdapterV2<Head>;
    readonly object: Readonly<{
      descriptor: LibraryCoreImmutableObjectReferenceV1["descriptor"];
      source: Uint8Array;
    }>;
  },
): Promise<LibraryCoreImmutableObjectReferenceV1> {
  const stored = await input.adapter.putImmutable(input.object);
  const descriptor = await input.adapter.verifyImmutable({
    descriptor: input.object.descriptor,
    transportObjectId: stored.transportObjectId,
  });
  return parseLibraryCoreImmutableObjectReferenceV1({
    descriptor,
    transportObjectId: stored.transportObjectId,
  });
}

export async function publishLibraryCoreNormalizedIntentSegmentV2(input: {
  readonly adapter: LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedIntentHeadV2>;
  readonly canonicalEnvelopes: readonly Uint8Array[];
  readonly subtle: SubtleCrypto;
}): Promise<Readonly<{
  publishedHead: LibraryCoreNormalizedIntentHeadV2;
  segmentReference: LibraryCoreImmutableObjectReferenceV1;
  status: "committed" | "recovered_after_response_loss";
}>> {
  const initial = await input.adapter.readHead();
  const expected = parseLibraryCoreNormalizedIntentHeadV2(initial.head);
  if (!equal(initial.bytes, headBytes(expected))) {
    throw new Error("normalized intent head is not exact canonical JSON");
  }
  const prepared = await prepareLibraryCoreNormalizedIntentSegmentV2({
    actorId: expected.actor_id,
    canonicalEnvelopes: input.canonicalEnvelopes,
    libraryId: expected.library_id,
    previousSegmentDigest: expected.latest_segment_digest,
    storageEpochId: expected.storage_epoch_id,
    subtle: input.subtle,
  });
  if (prepared.header.first_actor_counter !== expected.next_actor_counter) {
    throw new Error("normalized intent page does not extend its actor head");
  }
  const segmentReference = await publishImmutableSegmentV2({
    adapter: input.adapter,
    object: prepared.object,
  });
  const publishedHead = parseLibraryCoreNormalizedIntentHeadV2({
    actor_id: expected.actor_id,
    latest_segment: segmentReference,
    latest_segment_digest: segmentReference.descriptor.contentDigest,
    library_id: expected.library_id,
    next_actor_counter: prepared.header.last_actor_counter + 1,
    protocol: "normalized_intent_head_v2",
    protocol_version: 2,
    storage_epoch_id: expected.storage_epoch_id,
  });
  const status = await commitNormalizedHeadV2({
    adapter: input.adapter,
    expected: initial,
    next: publishedHead,
  });
  return Object.freeze({ publishedHead, segmentReference, status });
}

export async function publishLibraryCoreNormalizedResultSegmentV2(input: {
  readonly adapter: LibraryCoreNormalizedHeadPublicationAdapterV2<LibraryCoreNormalizedResultHeadV2>;
  readonly canonicalResults: readonly Uint8Array[];
  readonly subtle: SubtleCrypto;
}): Promise<Readonly<{
  publishedHead: LibraryCoreNormalizedResultHeadV2;
  segmentReference: LibraryCoreImmutableObjectReferenceV1;
  status: "committed" | "recovered_after_response_loss";
}>> {
  const initial = await input.adapter.readHead();
  const expected = parseLibraryCoreNormalizedResultHeadV2(initial.head);
  if (!equal(initial.bytes, headBytes(expected))) {
    throw new Error("normalized result head is not exact canonical JSON");
  }
  const prepared = await prepareLibraryCoreNormalizedResultSegmentV2({
    actorId: expected.actor_id,
    canonicalResults: input.canonicalResults,
    libraryId: expected.library_id,
    previousSegmentDigest: expected.latest_segment_digest,
    storageEpochId: expected.storage_epoch_id,
    subtle: input.subtle,
  });
  if (prepared.header.first_result_sequence !== expected.next_result_sequence) {
    throw new Error("normalized result page does not extend its actor head");
  }
  const segmentReference = await publishImmutableSegmentV2({
    adapter: input.adapter,
    object: prepared.object,
  });
  const publishedHead = parseLibraryCoreNormalizedResultHeadV2({
    actor_id: expected.actor_id,
    latest_segment: segmentReference,
    latest_segment_digest: segmentReference.descriptor.contentDigest,
    library_id: expected.library_id,
    next_result_sequence: prepared.header.last_result_sequence + 1,
    protocol: "normalized_result_head_v2",
    protocol_version: 2,
    storage_epoch_id: expected.storage_epoch_id,
  });
  const status = await commitNormalizedHeadV2({
    adapter: input.adapter,
    expected: initial,
    next: publishedHead,
  });
  return Object.freeze({ publishedHead, segmentReference, status });
}
