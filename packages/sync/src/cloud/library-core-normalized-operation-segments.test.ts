import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreNormalizedOperationHeadV2,
} from "@freed/shared/library-core";
import { prepareLibraryCoreNormalizedOperationSegmentV2, readLibraryCoreNormalizedOperationSegmentV2 } from "./library-core-normalized-operation-segments.js";

import { operationAnchor as anchor, operationSegmentFixture as segment } from "./normalized-operation.test-fixtures.js";

describe("normalized operation wire transport", () => {
  it("preserves exact canonical result bytes and binds the checkpoint, chain index and stored digest", async () => {
    const value = segment();
    const prepared = await prepareLibraryCoreNormalizedOperationSegmentV2(value);
    const reference = { descriptor: prepared.descriptor, transportObjectId: "object-1" };
    const request = { adapter: { readImmutable: async () => prepared.source }, reference, expectedAnchor: anchor, expectedSegmentIndex: 1 };
    expect(await readLibraryCoreNormalizedOperationSegmentV2(request)).toEqual(value);
    await expect(readLibraryCoreNormalizedOperationSegmentV2({ ...request, expectedAnchor: { ...anchor, checkpointDigest: "f".repeat(64) } })).rejects.toThrow("anchor");
    await expect(readLibraryCoreNormalizedOperationSegmentV2({ ...request, expectedSegmentIndex: 2 })).rejects.toThrow("index");
    const damaged = prepared.source.slice(); damaged[damaged.length - 1] ^= 1;
    await expect(readLibraryCoreNormalizedOperationSegmentV2({ ...request, adapter: { readImmutable: async () => damaged } })).rejects.toThrow("bytes changed");
  });
  it("rejects duplicate record order and heads that exceed the bounded recovery chain", async () => {
    const value = segment();
    await expect(prepareLibraryCoreNormalizedOperationSegmentV2({ ...value, page: { ...value.page, canonicalRecordBytes: value.page.canonicalRecordBytes * 2, records: [...value.page.records, ...value.page.records] } })).rejects.toThrow("ordered");
    const empty = { ...anchor, format: "freed_normalized_operation_head_v2", protocolVersion: 2, segmentCount: 0, tail: null };
    expect(parseLibraryCoreNormalizedOperationHeadV2(empty).tail).toBeNull();
    expect(() => parseLibraryCoreNormalizedOperationHeadV2({ ...empty, segmentCount: 65 })).toThrow("bound");
    expect(() => parseLibraryCoreNormalizedOperationHeadV2({ ...empty, segmentCount: 1 })).toThrow("incomplete");
  });
});
