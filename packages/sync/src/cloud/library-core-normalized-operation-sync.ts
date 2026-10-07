import {
  LIBRARY_CORE_OPERATION_CHAIN_MAXIMUM_SEGMENTS,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedOperationHeadV2,
  parseLibraryCoreNormalizedOperationExportPageV2,
  sameLibraryCoreNormalizedOperationAnchorV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreNormalizedOperationAnchorV2,
  type LibraryCoreNormalizedOperationHeadV2,
  type LibraryCoreNormalizedOperationExportDescriptorV2,
  type LibraryCoreNormalizedOperationExportRequestV2,
  type LibraryCoreNormalizedOperationExportPageV2,
  type LibraryCoreNormalizedOperationImportPageV2,
  type LibraryCoreNormalizedOperationImportReceiptV2,
} from "@freed/shared/library-core";
import type { LibraryCoreImmutablePublicationAdapterV1, LibraryCoreImmutableReadAdapterV1 } from "./library-core-immutable-publication.js";
import { prepareLibraryCoreNormalizedOperationSegmentV2, readLibraryCoreNormalizedOperationSegmentV2 } from "./library-core-normalized-operation-segments.js";

export interface LibraryCoreOperationHeadReadV2 {
  readonly head: LibraryCoreNormalizedOperationHeadV2 | null;
  readonly revision: string;
}
export type LibraryCoreOperationTransportV2 = LibraryCoreImmutableReadAdapterV1 & Pick<LibraryCoreImmutablePublicationAdapterV1<Uint8Array>, "putImmutable" | "verifyImmutable"> & {
  readOperationHead(): Promise<LibraryCoreOperationHeadReadV2>;
  compareAndSwapOperationHead(input: { readonly expectedRevision: string; readonly head: LibraryCoreNormalizedOperationHeadV2 }): Promise<"committed" | "conflict">;
};
export type LibraryCoreOperationPublicationV2 =
  | { readonly status: "checkpoint_required"; readonly reason: "revision_gap" | "chain_limit" | "content_dependency" }
  | { readonly status: "current" | "published"; readonly revision: number; readonly continuation: boolean };

function check(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
function sameHead(left: LibraryCoreNormalizedOperationHeadV2 | null, right: LibraryCoreNormalizedOperationHeadV2): boolean {
  if (!left) return false;
  const encode = (head: LibraryCoreNormalizedOperationHeadV2) => encodeLibraryCoreCanonicalValue(head as unknown as LibraryCoreCanonicalValue);
  const a = encode(left), b = encode(right);
  return a.length === b.length && a.every((byte,index) => byte === b[index]);
}
function completedRevision(page: LibraryCoreNormalizedOperationExportPageV2, fallback: number): number {
  let revision = fallback;
  for (const record of page.records) {
    if (record.kind !== "operation") continue;
    const envelope = JSON.parse(record.canonicalRecordJson) as { transaction_member_count: number };
    if (record.memberIndex + 1 === envelope.transaction_member_count) revision = record.sourceRevision;
  }
  return revision;
}

/** Publish one bounded page. A verified checkpoint handles administrative gaps
 * and bounds the retained operation chain. Response loss reuses exact bytes. */
export async function publishLibraryCoreNormalizedOperationsOnceV2(input: {
  readonly anchor: LibraryCoreNormalizedOperationAnchorV2;
  readonly transport: LibraryCoreOperationTransportV2;
  readonly source: {
    describe(): Promise<LibraryCoreNormalizedOperationExportDescriptorV2>;
    read(request: LibraryCoreNormalizedOperationExportRequestV2): Promise<LibraryCoreNormalizedOperationExportPageV2>;
  };
  readonly assertCurrentAuthority: () => Promise<void>;
  readonly signal?: AbortSignal;
}): Promise<LibraryCoreOperationPublicationV2> {
  check(input.signal);
  await input.assertCurrentAuthority();
  const stored = await input.transport.readOperationHead();
  const parsedHead = stored.head === null ? null : parseLibraryCoreNormalizedOperationHeadV2(stored.head);
  const head = parsedHead && sameLibraryCoreNormalizedOperationAnchorV2(parsedHead,input.anchor) ? parsedHead : null;
  const count = head?.segmentCount ?? 0;
  const previous = head?.tail ? await readLibraryCoreNormalizedOperationSegmentV2({
    adapter: input.transport, reference: head.tail, expectedAnchor: input.anchor, expectedSegmentIndex: count,
  }) : null;
  const previousRevision = previous ? completedRevision(previous.page,
    previous.page.records[0]!.sourceRevision - 1) : input.anchor.checkpointRevision;
  const snapshot = previous && !previous.page.done ? previous.snapshot : await input.source.describe();
  if (snapshot.libraryId !== input.anchor.libraryId || snapshot.authorityEpoch !== input.anchor.storageEpoch || snapshot.writerId !== input.anchor.writerId) {
    throw new Error("Operation publication authority changed.");
  }
  if (snapshot.sourceRevision === previousRevision && (!previous || previous.page.done)) {
    return { status: "current", revision: previousRevision, continuation: false };
  }
  if (snapshot.sourceRevision < previousRevision) throw new Error("Operation publication source regressed.");
  if (count >= LIBRARY_CORE_OPERATION_CHAIN_MAXIMUM_SEGMENTS) return { status: "checkpoint_required", reason: "chain_limit" };
  const continuing = previous !== null && !previous.page.done;
  const page = parseLibraryCoreNormalizedOperationExportPageV2(await input.source.read({
    snapshot, after: continuing ? previous.page.nextCursor : null,
    afterSourceRevision: continuing ? input.anchor.checkpointRevision : previousRevision,
    maximumRecords: 128, maximumResponseBytes: 1_048_576,
  }));
  check(input.signal);
  let revision = continuing ? previous.page.records.at(-1)!.sourceRevision : previousRevision;
  for (const record of page.records) {
    if (record.sourceRevision < revision || record.sourceRevision > revision + 1
      || (!continuing && record === page.records[0] && record.sourceRevision !== revision + 1)) {
      return { status: "checkpoint_required", reason: "revision_gap" };
    }
    revision = record.sourceRevision;
  }
  if (!page.records.length || (page.done && revision !== snapshot.sourceRevision)) return { status: "checkpoint_required", reason: "revision_gap" };
  // Protocol v2 operation pages do not carry canonical content descriptors.
  // Keep foreign-key dependencies in an authenticated checkpoint until a
  // descriptor stream can prove their availability before materialization.
  for (const record of page.records) {
    if (record.kind !== "operation") continue;
    const operation = JSON.parse(record.canonicalRecordJson) as {
      blob_references?: unknown[];
      payload?: { highlights?: { textBlobDigest?: string | null }[];
        event_candidate?: { evidence_blob_digest?: string | null } | null };
    };
    if (operation.blob_references?.length ||
        operation.payload?.highlights?.some((highlight) => highlight.textBlobDigest != null) ||
        operation.payload?.event_candidate?.evidence_blob_digest != null) {
      return { status: "checkpoint_required", reason: "content_dependency" };
    }
  }
  const prepared = await prepareLibraryCoreNormalizedOperationSegmentV2({
    ...input.anchor, format: "freed_normalized_operation_segment_v2", protocolVersion: 2,
    segmentIndex: count + 1, previous: head?.tail ?? null, snapshot, page,
  });
  const put = await input.transport.putImmutable(prepared);
  const proposedReference = { descriptor: prepared.descriptor, transportObjectId: put.transportObjectId };
  const verified = await input.transport.verifyImmutable(proposedReference);
  if (verified.objectKey !== prepared.descriptor.objectKey || verified.contentDigest !== prepared.descriptor.contentDigest || verified.byteLength !== prepared.descriptor.byteLength) {
    throw new Error("Published operation object verification changed.");
  }
  const next = parseLibraryCoreNormalizedOperationHeadV2({
    ...input.anchor, format: "freed_normalized_operation_head_v2", protocolVersion: 2,
    segmentCount: count + 1, tail: parseLibraryCoreImmutableObjectReferenceV1(proposedReference),
  });
  check(input.signal);
  await input.assertCurrentAuthority();
  try {
    const status = await input.transport.compareAndSwapOperationHead({ expectedRevision: stored.revision, head: next });
    if (status === "conflict" && !sameHead((await input.transport.readOperationHead()).head,next)) {
      throw new Error("Operation head changed concurrently.");
    }
  } catch (error) {
    if (!sameHead((await input.transport.readOperationHead()).head,next)) throw error;
  }
  if (!sameHead((await input.transport.readOperationHead()).head,next)) throw new Error("Operation head readback changed.");
  return { status: "published", revision: completedRevision(page,previousRevision), continuation: !page.done };
}

/** Traverse references with bounded metadata residency, then import one page at
 * a time in forward order. Never retain a chain of decoded Library pages. */
export async function syncLibraryCoreNormalizedOperationsOnceV2(input: {
  readonly anchor: LibraryCoreNormalizedOperationAnchorV2;
  readonly transport: LibraryCoreOperationTransportV2;
  readonly runtime: {
    readRevision(): Promise<number>;
    importPage(page: LibraryCoreNormalizedOperationImportPageV2): Promise<LibraryCoreNormalizedOperationImportReceiptV2>;
  };
  readonly now: () => number;
  readonly signal?: AbortSignal;
}): Promise<{ readonly revision: number; readonly importedSegments: number }> {
  check(input.signal);
  const currentRevision = await input.runtime.readRevision();
  if (!Number.isSafeInteger(currentRevision) || currentRevision < input.anchor.checkpointRevision) throw new Error("Consumer operation revision is behind its checkpoint.");
  const stored = await input.transport.readOperationHead();
  const head = stored.head === null ? null : parseLibraryCoreNormalizedOperationHeadV2(stored.head);
  if (!head) return { revision: currentRevision, importedSegments: 0 };
  if (!sameLibraryCoreNormalizedOperationAnchorV2(head,input.anchor)) {
    if (head.libraryId === input.anchor.libraryId && head.storageEpoch === input.anchor.storageEpoch
      && head.writerId === input.anchor.writerId && head.checkpointRevision < input.anchor.checkpointRevision) {
      return { revision: currentRevision, importedSegments: 0 };
    }
    throw new Error("Operation head checkpoint changed; refresh the verified checkpoint.");
  }
  const pending: { reference: LibraryCoreImmutableObjectReferenceV1; index: number }[] = [];
  let reference = head.tail;
  let index = head.segmentCount;
  while (reference) {
    check(input.signal);
    const segment = await readLibraryCoreNormalizedOperationSegmentV2({ adapter: input.transport, reference, expectedAnchor: input.anchor, expectedSegmentIndex: index });
    if (segment.page.records.at(-1)!.sourceRevision <= currentRevision) break;
    pending.push({ reference, index });
    reference = segment.previous;
    index -= 1;
  }
  let revision = currentRevision;
  for (const item of pending.reverse()) {
    check(input.signal);
    const segment = await readLibraryCoreNormalizedOperationSegmentV2({ adapter: input.transport, reference: item.reference, expectedAnchor: input.anchor, expectedSegmentIndex: item.index });
    const receipt = await input.runtime.importPage({ page: segment.page, receivedAt: input.now(), snapshot: segment.snapshot });
    if (receipt.appliedThroughRevision < revision || receipt.appliedThroughRevision > segment.snapshot.sourceRevision) throw new Error("Consumer operation import revision changed.");
    revision = receipt.appliedThroughRevision;
  }
  return { revision, importedSegments: pending.length };
}
