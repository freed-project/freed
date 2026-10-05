import { describe, expect, it, vi } from "vitest";
import { encodeLibraryCoreCanonicalValue, parseLibraryCoreNormalizedOperationExportPageV2, type LibraryCoreNormalizedOperationImportPageV2, type LibraryCoreNormalizedOperationHeadV2, type LibraryCoreImmutableObjectReferenceV1 } from "@freed/shared/library-core";
import { prepareLibraryCoreNormalizedOperationSegmentV2 } from "./library-core-normalized-operation-segments.js";
import { operationAnchor as anchor, operationSegmentFixture } from "./normalized-operation.test-fixtures.js";
import { publishLibraryCoreNormalizedOperationsOnceV2, syncLibraryCoreNormalizedOperationsOnceV2, type LibraryCoreOperationTransportV2 } from "./library-core-normalized-operation-sync.js";

function memoryTransport() {
  let head: LibraryCoreNormalizedOperationHeadV2 | null = null;
  let revision = 0;
  let loseResponse = false;
  const objects = new Map<string, Uint8Array>();
  const transport: LibraryCoreOperationTransportV2 = {
    async readOperationHead() { return { head, revision: `etag-${revision}` }; },
    async compareAndSwapOperationHead(input) {
      if (input.expectedRevision !== `etag-${revision}`) return "conflict";
      head = input.head; revision += 1;
      if (loseResponse) { loseResponse = false; throw new Error("response lost"); }
      return "committed";
    },
    async putImmutable(input) { const id = input.descriptor.contentDigest; objects.set(id,input.source); return { transportObjectId: id }; },
    async verifyImmutable(input) { expect(objects.has(input.transportObjectId)).toBe(true); return input.descriptor; },
    async readImmutable(reference: LibraryCoreImmutableObjectReferenceV1) { const value=objects.get(reference.transportObjectId); if (!value) throw new Error("missing object"); return value; },
  };
  return { transport, loseNextResponse() { loseResponse = true; }, objects };
}
function completePage() {
  const fixture = operationSegmentFixture();
  const operation = {
    actor_chain_digest: "a".repeat(64), actor_id: anchor.writerId, actor_sequence: 1,
    blob_references: [], causal_frontier: [], created_at_ms: 1, entity_id: "item-1", entity_type: "FeedItem",
    epoch: 1, epoch_id: anchor.storageEpoch, hlc_counter: 0, hlc_wall_ms: 1, library_id: anchor.libraryId,
    operation_id: "operation-1", operation_type: "feed_item_read_assignment", payload: { read_at_ms: 1 },
    payload_digest: "b".repeat(64), previous_actor_chain_digest: "c".repeat(64), previous_actor_operation_id: null,
    schema_version: 1, signature: "d".repeat(128), signature_algorithm: "ed25519",
    transaction_digest: "8".repeat(64), transaction_id: "transaction-1", transaction_member_count: 1, transaction_member_index: 0,
  };
  const canonical = encodeLibraryCoreCanonicalValue(operation);
  const member = { canonicalRecordJson: new TextDecoder().decode(canonical), kind: "operation", memberIndex: 0,
    recordDigest: "e".repeat(64), sourceRevision: 1, transactionDigest: "8".repeat(64), transactionId: "transaction-1" };
  return { snapshot: fixture.snapshot, page: parseLibraryCoreNormalizedOperationExportPageV2({
    canonicalRecordBytes: fixture.page.canonicalRecordBytes + canonical.byteLength, done: true,
    nextCursor: { kind:member.kind,memberIndex:0,recordDigest:member.recordDigest,sourceRevision:1 },
    records:[...fixture.page.records,member],
  }) };
}

describe("normalized operation sync ownership", () => {
  it("recovers a committed head after response loss and imports the chain once", async () => {
    const memory=memoryTransport();memory.loseNextResponse();
    const exported=completePage();
    const source={describe:async()=>exported.snapshot,read:vi.fn(async()=>exported.page)};
    const authority=vi.fn(async()=>{});
    const result=await publishLibraryCoreNormalizedOperationsOnceV2({anchor,transport:memory.transport,source,assertCurrentAuthority:authority});
    expect(result).toEqual({status:"published",revision:1,continuation:false});
    expect(memory.objects.size).toBe(1);expect(authority).toHaveBeenCalledTimes(2);
    let revision=0;
    const importPage=vi.fn(async (input) => { expect(input.page).toEqual(exported.page);revision=1;return {appliedThroughRevision:1,appliedTransactionCount:1,receivedAt:input.receivedAt,stagedRecordCount:2,stagedTransactionCount:1}; });
    const input={anchor,transport:memory.transport,runtime:{readRevision:async()=>revision,importPage},now:()=>100};
    expect(await syncLibraryCoreNormalizedOperationsOnceV2(input)).toEqual({revision:1,importedSegments:1});
    expect(await syncLibraryCoreNormalizedOperationsOnceV2(input)).toEqual({revision:1,importedSegments:0});
    expect(importPage).toHaveBeenCalledOnce();
    expect(await publishLibraryCoreNormalizedOperationsOnceV2({anchor,transport:memory.transport,source,assertCurrentAuthority:authority})).toEqual({status:"current",revision:1,continuation:false});
    expect(source.read).toHaveBeenCalledOnce();
  });
  it("resumes a split transaction after publication and consumer restart", async () => {
    const memory = memoryTransport();
    const exported = completePage();
    const first = operationSegmentFixture().page;
    const member = exported.page.records[1]!;
    const second = parseLibraryCoreNormalizedOperationExportPageV2({
      ...exported.page, records: [member],
      canonicalRecordBytes: new TextEncoder().encode(member.canonicalRecordJson).byteLength,
    });
    const source = {
      describe: vi.fn(async () => exported.snapshot),
      read: vi.fn(async (request) => request.after === null ? first : second),
    };
    const publish = () => publishLibraryCoreNormalizedOperationsOnceV2({ anchor,
      transport: memory.transport, source, assertCurrentAuthority: async () => {} });
    expect(await publish()).toEqual({ status: "published", revision: 0, continuation: true });
    let revision = 0;
    const staged: unknown[] = [];
    const importPage = vi.fn(async (input: LibraryCoreNormalizedOperationImportPageV2) => {
      staged.push(...input.page.records);
      if (input.page.records.some((record) => record.kind === "operation")) revision = 1;
      return { appliedThroughRevision: revision, appliedTransactionCount: revision,
        receivedAt: input.receivedAt, stagedRecordCount: input.page.records.length, stagedTransactionCount: 1 };
    });
    const consume = () => syncLibraryCoreNormalizedOperationsOnceV2({ anchor,
      transport: memory.transport, runtime: { readRevision: async () => revision, importPage }, now: () => 10 });
    expect(await consume()).toEqual({ revision: 0, importedSegments: 1 });
    // Fresh coordinator calls recover exclusively from durable head and revision.
    expect(await publish()).toEqual({ status: "published", revision: 1, continuation: false });
    expect(source.describe).toHaveBeenCalledTimes(1);
    expect(source.read.mock.calls[1]![0]).toMatchObject({ after: first.nextCursor, snapshot: exported.snapshot });
    expect(await consume()).toEqual({ revision: 1, importedSegments: 2 });
    expect(staged).toEqual([first.records[0], first.records[0], member]);
    expect(await consume()).toEqual({ revision: 1, importedSegments: 0 });
  });

  it("bounds retained segments and requires a checkpoint before extending the chain", async () => {
    const memory = memoryTransport();
    const exported = completePage();
    const initial = await prepareLibraryCoreNormalizedOperationSegmentV2({ ...operationSegmentFixture(), page: exported.page });
    const initialPut = await memory.transport.putImmutable(initial);
    const previous = { descriptor: initial.descriptor, transportObjectId: initialPut.transportObjectId };
    const tail = await prepareLibraryCoreNormalizedOperationSegmentV2({ ...operationSegmentFixture(),
      page: exported.page, segmentIndex: 64, previous });
    const tailPut = await memory.transport.putImmutable(tail);
    await memory.transport.compareAndSwapOperationHead({ expectedRevision: "etag-0",
      head: { ...anchor, format: "freed_normalized_operation_head_v2", protocolVersion: 2,
        segmentCount: 64, tail: { descriptor: tail.descriptor, transportObjectId: tailPut.transportObjectId } } });
    const source = { describe: async () => ({ ...exported.snapshot, sourceRevision: 2 }), read: vi.fn() };
    expect(await publishLibraryCoreNormalizedOperationsOnceV2({ anchor, transport: memory.transport,
      source, assertCurrentAuthority: async () => {} })).toEqual({ status: "checkpoint_required", reason: "chain_limit" });
    expect(source.read).not.toHaveBeenCalled();
  });

  it.each(["highlight", "event", "blob"])("checkpoints %s content dependencies before publishing operations", async (kind) => {
    const memory = memoryTransport();
    const exported = completePage();
    const member = exported.page.records[1]!;
    const operation = JSON.parse(member.canonicalRecordJson);
    if (kind === "highlight") operation.payload = { highlights: [{ textBlobDigest: "f".repeat(64) }] };
    if (kind === "event") operation.payload = { event_candidate: { evidence_blob_digest: "f".repeat(64) } };
    if (kind === "blob") operation.blob_references = ["f".repeat(64)];
    const canonical = encodeLibraryCoreCanonicalValue(operation);
    const records = [exported.page.records[0]!, { ...member, canonicalRecordJson: new TextDecoder().decode(canonical) }];
    const page = parseLibraryCoreNormalizedOperationExportPageV2({ ...exported.page, records,
      canonicalRecordBytes: records.reduce((sum, record) => sum + new TextEncoder().encode(record.canonicalRecordJson).byteLength, 0) });
    expect(await publishLibraryCoreNormalizedOperationsOnceV2({ anchor, transport: memory.transport,
      source: { describe: async () => exported.snapshot, read: async () => page },
      assertCurrentAuthority: async () => {} })).toEqual({ status: "checkpoint_required", reason: "content_dependency" });
    expect(memory.objects.size).toBe(0);
  });

  it("requires a checkpoint for an administrative revision gap and stops before I/O when canceled", async () => {
    const memory=memoryTransport();const exported=completePage();
    const result=JSON.parse(exported.page.records[0]!.canonicalRecordJson);result.authoritative_source_revision=3;
    const records=exported.page.records.map((record,index)=>({...record,sourceRevision:3,canonicalRecordJson:index===0?new TextDecoder().decode(encodeLibraryCoreCanonicalValue(result)):record.canonicalRecordJson}));
    const page=parseLibraryCoreNormalizedOperationExportPageV2({...exported.page,records,nextCursor:{...exported.page.nextCursor,sourceRevision:3}});
    const source={describe:async()=>({...exported.snapshot,sourceRevision:3}),read:vi.fn(async()=>page)};
    expect(await publishLibraryCoreNormalizedOperationsOnceV2({anchor,transport:memory.transport,source,assertCurrentAuthority:async()=>{}})).toEqual({status:"checkpoint_required",reason:"revision_gap"});
    expect(memory.objects.size).toBe(0);
    const abort=new AbortController();abort.abort();const authority=vi.fn();
    await expect(publishLibraryCoreNormalizedOperationsOnceV2({anchor,transport:memory.transport,source,assertCurrentAuthority:authority,signal:abort.signal})).rejects.toThrow();
    expect(authority).not.toHaveBeenCalled();
  });
});
