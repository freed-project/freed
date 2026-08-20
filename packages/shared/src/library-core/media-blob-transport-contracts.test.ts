import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createLibraryCoreMediaBlobDigestStateV1,
  createLibraryCoreMediaBlobObjectKey,
  digestLibraryCoreMediaBlobBytesV1,
  isLibraryCoreMediaBlobObjectKey,
  LIBRARY_CORE_MEDIA_BLOB_BYTE_LIMIT,
  parseLibraryCoreMediaBlobDescriptorV1,
  parseLibraryCoreMediaBlobReferenceV1,
} from "./media-blob-transport-contracts.js";
import { isLibraryCoreImmutableObjectKey } from "./immutable-transport-contracts.js";

const encoder = new TextEncoder();

function expectedBlobDigest(bytes: Uint8Array): string {
  return createHash("sha256")
    .update("freed.library-core.v1/digest-bytes/blob-content\0")
    .update(bytes)
    .digest("hex");
}

describe("Library Core media blob transport contract", () => {
  it("matches the fixed public DB(blob-content) vectors", () => {
    expect(digestLibraryCoreMediaBlobBytesV1(new Uint8Array())).toBe(
      "ba9706c0678e7dd17211f7c9c8883517212045888c0c4cb3a5632b4efd04d1fc",
    );
    expect(digestLibraryCoreMediaBlobBytesV1(encoder.encode("abc"))).toBe(
      "9502e1d6f39c194e82a0cbc2e1e0749d1b2fcf261e6980f431e42ae9fe3e6f39",
    );
  });

  it("domain-separates raw blob bytes and supports incremental hashing", () => {
    const first = encoder.encode("first");
    const second = encoder.encode("second");
    const combined = encoder.encode("firstsecond");
    const state = createLibraryCoreMediaBlobDigestStateV1();
    state.update(first).update(second);

    expect(state.digestLowerHex()).toBe(expectedBlobDigest(combined));
    expect(digestLibraryCoreMediaBlobBytesV1(combined)).toBe(
      expectedBlobDigest(combined),
    );
    expect(digestLibraryCoreMediaBlobBytesV1(combined)).not.toBe(
      createHash("sha256").update(combined).digest("hex"),
    );
  });

  it("accepts a zero-byte blob with its exact domain-separated identity", () => {
    const blobContentDigest = expectedBlobDigest(new Uint8Array());
    const objectKey = createLibraryCoreMediaBlobObjectKey({
      libraryId: "library-1",
      blobContentDigest,
    });

    expect(
      parseLibraryCoreMediaBlobDescriptorV1({
        objectKey,
        blobContentDigest,
        byteLength: 0,
      }),
    ).toEqual({ objectKey, blobContentDigest, byteLength: 0 });
    expect(isLibraryCoreMediaBlobObjectKey(objectKey)).toBe(true);
    expect(isLibraryCoreImmutableObjectKey(objectKey)).toBe(false);
  });

  it("keeps blob descriptors separate from ordinary immutable descriptors", () => {
    const blobContentDigest = expectedBlobDigest(encoder.encode("media"));
    const objectKey = createLibraryCoreMediaBlobObjectKey({
      libraryId: "library-1",
      blobContentDigest,
    });

    expect(() =>
      parseLibraryCoreMediaBlobDescriptorV1({
        objectKey,
        contentDigest: blobContentDigest,
        byteLength: 5,
      }),
    ).toThrow("unknown or missing fields");
    expect(() =>
      parseLibraryCoreMediaBlobDescriptorV1({
        objectKey,
        blobContentDigest: "00".repeat(32),
        byteLength: 5,
      }),
    ).toThrow("does not match objectKey");
    expect(() =>
      parseLibraryCoreMediaBlobDescriptorV1({
        objectKey,
        blobContentDigest,
        byteLength: LIBRARY_CORE_MEDIA_BLOB_BYTE_LIMIT + 1,
      }),
    ).toThrow("no greater than");
  });

  it("closes blob references without trusting nested paths or filesystem names", () => {
    const blobContentDigest = expectedBlobDigest(encoder.encode("media"));
    const descriptor = parseLibraryCoreMediaBlobDescriptorV1({
      objectKey: createLibraryCoreMediaBlobObjectKey({
        libraryId: "library-1",
        blobContentDigest,
      }),
      blobContentDigest,
      byteLength: 5,
    });

    expect(
      parseLibraryCoreMediaBlobReferenceV1({
        descriptor,
        transportObjectId: "drive-file-1",
      }),
    ).toEqual({ descriptor, transportObjectId: "drive-file-1" });
    for (const objectKey of [
      `freed-v2-blob~library-1~${blobContentDigest}/nested`,
      `freed-v2-blob~library.sqlite~${blobContentDigest}`,
      `freed-v2-blob~library-1~${blobContentDigest}.wal`,
      `freed-v2-blob~library-1~${blobContentDigest}.shm`,
      `freed-v2-blob~library-1~${blobContentDigest}.journal`,
    ]) {
      expect(isLibraryCoreMediaBlobObjectKey(objectKey)).toBe(false);
    }
  });

  it("rejects accessors and unknown fields before reading descriptor values", () => {
    const blobContentDigest = expectedBlobDigest(encoder.encode("media"));
    const objectKey = createLibraryCoreMediaBlobObjectKey({
      libraryId: "library-1",
      blobContentDigest,
    });
    let accessed = false;

    expect(() =>
      parseLibraryCoreMediaBlobDescriptorV1({
        objectKey,
        blobContentDigest,
        get byteLength() {
          accessed = true;
          return 5;
        },
      }),
    ).toThrow("enumerable data property");
    expect(accessed).toBe(false);
    expect(() =>
      parseLibraryCoreMediaBlobReferenceV1({
        descriptor: { objectKey, blobContentDigest, byteLength: 5 },
        transportObjectId: "drive-file-1",
        sourcePath: "/private/library.sqlite",
      }),
    ).toThrow("unknown or missing fields");
  });
});
