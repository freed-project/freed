import { describe, expect, it } from "vitest";
import {
  createLibraryCoreControlObjectKey,
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreIntentHeadObjectKey,
  createLibraryCoreResultHeadObjectKey,
  isLibraryCoreImmutableObjectKey,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
} from "./immutable-transport-contracts.js";

const DIGEST = "ab".repeat(32);
const OTHER_DIGEST = "cd".repeat(32);
const LIBRARY_ID = "library-1";

function manifestKey(
  epochId = "epoch-1",
  generation = 7,
  digest = DIGEST,
  libraryId = LIBRARY_ID,
): string {
  return createLibraryCoreImmutableObjectKey({
    kind: "checkpoint_manifest",
    libraryId,
    epochId,
    generation,
    digest,
  });
}

describe("Library Core immutable transport contract", () => {
  it("constructs every flat immutable object family", () => {
    const keys = [
      createLibraryCoreImmutableObjectKey({
        kind: "epoch_certificate",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "actor_enrollment",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        actorId: "desktop-1",
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "operation_segment",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        firstSequence: 1,
        lastSequence: 128,
        digest: DIGEST,
      }),
      manifestKey(),
      createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_page",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        generation: 7,
        pageIndex: 2,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "search_manifest",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        generation: 7,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "search_shard",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        generation: 7,
        shardIndex: 2,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "search_delta",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        firstSequence: 129,
        lastSequence: 256,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "intent_segment",
        libraryId: LIBRARY_ID,
        actorId: "pwa-1",
        firstSequence: 1,
        lastSequence: 9,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "result_segment",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        actorId: "pwa-1",
        firstSequence: 1,
        lastSequence: 9,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "blob",
        libraryId: LIBRARY_ID,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "backup_manifest",
        libraryId: LIBRARY_ID,
        backupId: "backup-2026-07-30",
        digest: DIGEST,
      }),
    ];

    expect(keys).toEqual([
      `freed-v2-epoch~library-1~epoch-1~${DIGEST}.json`,
      `freed-v2-enrollment~library-1~epoch-1~desktop-1~${DIGEST}.json`,
      `freed-v2-ops~library-1~eepoch-1~s1-128~${DIGEST}.fseg.gz`,
      `freed-v2-manifest~library-1~eepoch-1~g7~${DIGEST}.json`,
      `freed-v2-checkpoint~library-1~eepoch-1~g7~p2~${DIGEST}.fpage.gz`,
      `freed-v2-search~library-1~eepoch-1~g7~manifest~${DIGEST}.json`,
      `freed-v2-search~library-1~eepoch-1~g7~s2~${DIGEST}.fidx.gz`,
      `freed-v2-search-delta~library-1~eepoch-1~s129-256~${DIGEST}.fidx.gz`,
      `freed-v2-intents~library-1~pwa-1~s1-9~${DIGEST}.fseg.gz`,
      `freed-v2-results~library-1~eepoch-1~pwa-1~s1-9~${DIGEST}.fseg.gz`,
      `freed-v2-blob~library-1~${DIGEST}`,
      `freed-v2-backup~library-1~backup-2026-07-30~${DIGEST}.json`,
    ]);
    expect(keys.every(isLibraryCoreImmutableObjectKey)).toBe(true);
    expect(keys.every((key) => !key.includes("/"))).toBe(true);
  });

  it("constructs mutable heads separately and never accepts them as immutable", () => {
    const mutableKeys = [
      createLibraryCoreControlObjectKey(LIBRARY_ID),
      createLibraryCoreIntentHeadObjectKey(LIBRARY_ID, "pwa-1"),
      createLibraryCoreResultHeadObjectKey(LIBRARY_ID, "epoch-1", "pwa-1"),
    ];

    expect(mutableKeys).toEqual([
      "freed-v2-control~library-1.json",
      "freed-v2-intent-head~library-1~pwa-1.json",
      "freed-v2-result-head~library-1~eepoch-1~pwa-1.json",
    ]);
    expect(mutableKeys.some(isLibraryCoreImmutableObjectKey)).toBe(false);
  });

  it("keeps hyphenated library, epoch, and actor tuples unambiguous", () => {
    const firstOperation = createLibraryCoreImmutableObjectKey({
      kind: "operation_segment",
      libraryId: "library-a",
      epochId: "epoch-b",
      firstSequence: 1,
      lastSequence: 1,
      digest: DIGEST,
    });
    const secondOperation = createLibraryCoreImmutableObjectKey({
      kind: "operation_segment",
      libraryId: "library",
      epochId: "a-epoch-b",
      firstSequence: 1,
      lastSequence: 1,
      digest: DIGEST,
    });
    const firstHead = createLibraryCoreIntentHeadObjectKey(
      "library-a",
      "pwa-b",
    );
    const secondHead = createLibraryCoreIntentHeadObjectKey(
      "library",
      "a-pwa-b",
    );

    expect(firstOperation).not.toBe(secondOperation);
    expect(firstHead).not.toBe(secondHead);
    expect(isLibraryCoreImmutableObjectKey(firstOperation)).toBe(true);
    expect(isLibraryCoreImmutableObjectKey(secondOperation)).toBe(true);
  });

  it("rejects SQLite files, nested paths, malformed ranges, and unsafe indexes", () => {
    for (const key of [
      "library.sqlite",
      "library.sqlite-wal",
      "library.sqlite-shm",
      "library.sqlite-journal",
      `checkpoints/epoch-1/7/desktop-${DIGEST}.sqlite`,
      `freed-v2-ops~library-1~eepoch-1~s2-1~${DIGEST}.fseg.gz`,
      `freed-v2-checkpoint~library-1~eepoch-1~g${Number.MAX_SAFE_INTEGER + 1}~p0~${DIGEST}.fpage.gz`,
      `freed-v2-blob~library-1~${OTHER_DIGEST}/nested`,
    ]) {
      expect(isLibraryCoreImmutableObjectKey(key)).toBe(false);
    }

    expect(() =>
      createLibraryCoreImmutableObjectKey({
        kind: "operation_segment",
        libraryId: LIBRARY_ID,
        epochId: "epoch-1",
        firstSequence: 2,
        lastSequence: 1,
        digest: DIGEST,
      }),
    ).toThrow(/lastSequence/);
    expect(() =>
      createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_page",
        libraryId: LIBRARY_ID,
        epochId: "../epoch",
        generation: 1,
        pageIndex: 0,
        digest: DIGEST,
      }),
    ).toThrow(/epochId/);
  });

  it("snapshots descriptors and binds content to the locator digest", () => {
    const source = {
      objectKey: manifestKey(),
      contentDigest: DIGEST,
      byteLength: 4_096,
    };
    const parsed = parseLibraryCoreImmutableObjectDescriptorV1(source);
    source.objectKey = manifestKey("epoch-1", 8, OTHER_DIGEST);

    expect(parsed).toEqual({
      objectKey: manifestKey(),
      contentDigest: DIGEST,
      byteLength: 4_096,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() =>
      parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: manifestKey(),
        contentDigest: OTHER_DIGEST,
        byteLength: 4_096,
      }),
    ).toThrow(/contentDigest does not match objectKey/);
  });

  it("closes one non-expiring writer epoch, library, manifest, and transport", () => {
    const source = {
      schemaVersion: 1,
      protocolVersion: 1,
      libraryId: LIBRARY_ID,
      storageEpoch: "epoch-1",
      writerId: "desktop-1",
      activeTransport: "google_drive_app_data_v1",
      generation: 7,
      causalFrontierDigest: OTHER_DIGEST,
      manifest: {
        descriptor: {
          objectKey: manifestKey(),
          contentDigest: DIGEST,
          byteLength: 4_096,
        },
        transportObjectId: "drive-file-1",
      },
    };
    const parsed = parseLibraryCoreControlPointerV1(source);
    source.writerId = "desktop-2";
    source.manifest.descriptor.byteLength = 1;

    expect(parsed.writerId).toBe("desktop-1");
    expect(parsed.manifest.descriptor.byteLength).toBe(4_096);
    expect(parsed.manifest.transportObjectId).toBe("drive-file-1");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.manifest)).toBe(true);
    expect(Object.isFrozen(parsed.manifest.descriptor)).toBe(true);

    for (const invalid of [
      { ...source, expiresAt: 123 },
      { ...source, heartbeatAt: 123 },
      {
        ...source,
        activeTransports: ["google_drive_app_data_v1", "dropbox_app_folder_v1"],
      },
      { ...source, activeTransport: "filesystem_sqlite_sync_v1" },
      {
        ...source,
        manifest: {
          ...source.manifest,
          descriptor: {
            ...source.manifest.descriptor,
            objectKey: manifestKey("epoch-2"),
          },
        },
      },
      {
        ...source,
        manifest: {
          ...source.manifest,
          descriptor: {
            ...source.manifest.descriptor,
            objectKey: manifestKey("epoch-1", 7, DIGEST, "library-2"),
          },
        },
      },
      {
        ...source,
        manifest: {
          ...source.manifest,
          transportObjectId: "",
        },
      },
    ]) {
      expect(() => parseLibraryCoreControlPointerV1(invalid)).toThrow();
    }
  });

  it("rejects accessors and unknown descriptor fields before reading them", () => {
    let accessed = false;
    const descriptor = {
      objectKey: manifestKey(),
      contentDigest: DIGEST,
      get byteLength() {
        accessed = true;
        return 4_096;
      },
    };

    expect(() =>
      parseLibraryCoreImmutableObjectDescriptorV1(descriptor),
    ).toThrow(/enumerable data property/);
    expect(accessed).toBe(false);
    expect(() =>
      parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: manifestKey(),
        contentDigest: DIGEST,
        byteLength: 4_096,
        transportObjectId: "provider-owned",
      }),
    ).toThrow(/unknown or missing/);
  });
});
