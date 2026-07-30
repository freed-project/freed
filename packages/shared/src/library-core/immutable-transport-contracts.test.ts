import { describe, expect, it } from "vitest";
import {
  LIBRARY_CORE_CONTROL_OBJECT_KEY,
  createLibraryCoreImmutableObjectKey,
  isLibraryCoreImmutableObjectKey,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
} from "./immutable-transport-contracts.js";

const DIGEST = "ab".repeat(32);
const OTHER_DIGEST = "cd".repeat(32);

describe("Library Core immutable transport contract", () => {
  it("constructs every registered immutable object family", () => {
    const keys = [
      createLibraryCoreImmutableObjectKey({
        kind: "epoch_certificate",
        epochId: "epoch-1",
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "actor_enrollment",
        actorId: "desktop-1",
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "operation_segment",
        epochId: "epoch-1",
        actorId: "desktop-1",
        firstSequence: 1,
        lastSequence: 128,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_manifest",
        epochId: "epoch-1",
        generation: 7,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_page",
        epochId: "epoch-1",
        generation: 7,
        pageIndex: 2,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "desktop_checkpoint",
        epochId: "epoch-1",
        generation: 7,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "search_base",
        epochId: "epoch-1",
        generation: 7,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "search_delta",
        epochId: "epoch-1",
        generation: 7,
        firstSequence: 129,
        lastSequence: 256,
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "intent",
        actorId: "pwa-1",
        sequence: 9,
        operationId: "operation-9",
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({
        kind: "intent_result",
        actorId: "pwa-1",
        sequence: 9,
        operationId: "operation-9",
        digest: DIGEST,
      }),
      createLibraryCoreImmutableObjectKey({ kind: "blob", digest: DIGEST }),
      createLibraryCoreImmutableObjectKey({
        kind: "backup_manifest",
        backupId: "backup-2026-07-30",
        digest: DIGEST,
      }),
    ];

    expect(keys).toEqual([
      "epochs/epoch-1/epoch-certificate.cbor",
      `actors/desktop-1/enrollment-${DIGEST}.cbor`,
      `operations/epoch-1/desktop-1/1-128-${DIGEST}.cbor`,
      `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
      `checkpoints/epoch-1/7/pages/2-${DIGEST}.cbor`,
      `checkpoints/epoch-1/7/desktop-${DIGEST}.sqlite`,
      `search/epoch-1/7/base-${DIGEST}.cbor`,
      `search/epoch-1/7/delta-129-256-${DIGEST}.cbor`,
      `intents/pwa-1/9-operation-9-${DIGEST}.cbor`,
      `intent-results/pwa-1/9-operation-9-${DIGEST}.cbor`,
      `blobs/ab/${DIGEST}`,
      `backups/backup-2026-07-30/manifest-${DIGEST}.cbor`,
    ]);
    expect(keys.every(isLibraryCoreImmutableObjectKey)).toBe(true);
  });

  it("rejects mutable SQLite files and the mutable control pointer as immutable objects", () => {
    expect(
      isLibraryCoreImmutableObjectKey(LIBRARY_CORE_CONTROL_OBJECT_KEY),
    ).toBe(false);
    expect(isLibraryCoreImmutableObjectKey("library.sqlite")).toBe(false);
    expect(isLibraryCoreImmutableObjectKey("library.sqlite-wal")).toBe(false);
    expect(isLibraryCoreImmutableObjectKey("library.sqlite-shm")).toBe(false);
    expect(isLibraryCoreImmutableObjectKey("library.sqlite-journal")).toBe(
      false,
    );
    expect(
      isLibraryCoreImmutableObjectKey(
        `checkpoints/epoch-1/7/desktop-${DIGEST}.sqlite-wal`,
      ),
    ).toBe(false);
  });

  it("rejects traversal, malformed ranges, and unsafe numeric locators", () => {
    expect(() =>
      createLibraryCoreImmutableObjectKey({
        kind: "operation_segment",
        epochId: "epoch-1",
        actorId: "desktop-1",
        firstSequence: 2,
        lastSequence: 1,
        digest: DIGEST,
      }),
    ).toThrow(/lastSequence/);
    expect(() =>
      createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_page",
        epochId: "../epoch",
        generation: 1,
        pageIndex: 0,
        digest: DIGEST,
      }),
    ).toThrow(/epochId/);
    expect(() =>
      createLibraryCoreImmutableObjectKey({
        kind: "checkpoint_page",
        epochId: "epoch-1",
        generation: Number.MAX_SAFE_INTEGER + 1,
        pageIndex: 0,
        digest: DIGEST,
      }),
    ).toThrow(/generation/);
    expect(
      isLibraryCoreImmutableObjectKey(
        `operations/epoch-1/desktop-1/2-1-${DIGEST}.cbor`,
      ),
    ).toBe(false);
    expect(
      isLibraryCoreImmutableObjectKey(
        `checkpoints/epoch-1/${Number.MAX_SAFE_INTEGER + 1}/manifest-${DIGEST}.cbor`,
      ),
    ).toBe(false);
    expect(
      isLibraryCoreImmutableObjectKey(
        `checkpoints/epoch-1/1/pages/${Number.MAX_SAFE_INTEGER + 1}-${DIGEST}.cbor`,
      ),
    ).toBe(false);
    expect(
      isLibraryCoreImmutableObjectKey(
        `search/epoch-1/${Number.MAX_SAFE_INTEGER + 1}/delta-1-2-${DIGEST}.cbor`,
      ),
    ).toBe(false);
    expect(isLibraryCoreImmutableObjectKey(`blobs/cd/${DIGEST}`)).toBe(false);
  });

  it("snapshots a closed immutable descriptor without retaining aliases", () => {
    const source = {
      objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
      contentDigest: DIGEST,
      byteLength: 4_096,
    };
    const parsed = parseLibraryCoreImmutableObjectDescriptorV1(source);
    source.objectKey = `checkpoints/epoch-1/8/manifest-${OTHER_DIGEST}.cbor`;

    expect(parsed).toEqual({
      objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
      contentDigest: DIGEST,
      byteLength: 4_096,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("binds descriptor content to the digest encoded by its locator", () => {
    expect(() =>
      parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
        contentDigest: OTHER_DIGEST,
        byteLength: 4_096,
      }),
    ).toThrow(/contentDigest does not match objectKey/);
    expect(() =>
      parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: `blobs/ab/${DIGEST}`,
        contentDigest: OTHER_DIGEST,
        byteLength: 4_096,
      }),
    ).toThrow(/contentDigest does not match objectKey/);
  });

  it("closes one non-expiring writer epoch and one active transport", () => {
    const source = {
      schemaVersion: 1,
      protocolVersion: 1,
      libraryId: "library-1",
      storageEpoch: "epoch-1",
      writerId: "desktop-1",
      activeTransport: "google_drive_app_data_v1",
      generation: 7,
      causalFrontierDigest: OTHER_DIGEST,
      manifest: {
        objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
        contentDigest: DIGEST,
        byteLength: 4_096,
      },
    };

    const parsed = parseLibraryCoreControlPointerV1(source);
    source.writerId = "desktop-2";
    source.manifest.byteLength = 1;

    expect(parsed.writerId).toBe("desktop-1");
    expect(parsed.manifest.byteLength).toBe(4_096);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.manifest)).toBe(true);
  });

  it("rejects expiry, heartbeat, dual authority, and unknown transport fields", () => {
    const valid = {
      schemaVersion: 1,
      protocolVersion: 1,
      libraryId: "library-1",
      storageEpoch: "epoch-1",
      writerId: "desktop-1",
      activeTransport: "google_drive_app_data_v1",
      generation: 7,
      causalFrontierDigest: OTHER_DIGEST,
      manifest: {
        objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
        contentDigest: DIGEST,
        byteLength: 4_096,
      },
    };

    expect(() =>
      parseLibraryCoreControlPointerV1({ ...valid, expiresAt: 123 }),
    ).toThrow(/unknown or missing/);
    expect(() =>
      parseLibraryCoreControlPointerV1({ ...valid, heartbeatAt: 123 }),
    ).toThrow(/unknown or missing/);
    expect(() =>
      parseLibraryCoreControlPointerV1({
        ...valid,
        activeTransports: ["google_drive_app_data_v1", "dropbox_app_folder_v1"],
      }),
    ).toThrow(/unknown or missing/);
    expect(() =>
      parseLibraryCoreControlPointerV1({
        ...valid,
        activeTransport: "filesystem_sqlite_sync_v1",
      }),
    ).toThrow(/activeTransport/);
  });

  it("binds the control pointer to its exact epoch and generation manifest", () => {
    const valid = {
      schemaVersion: 1,
      protocolVersion: 1,
      libraryId: "library-1",
      storageEpoch: "epoch-1",
      writerId: "desktop-1",
      activeTransport: "google_drive_app_data_v1",
      generation: 7,
      causalFrontierDigest: OTHER_DIGEST,
      manifest: {
        objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
        contentDigest: DIGEST,
        byteLength: 4_096,
      },
    };

    expect(() =>
      parseLibraryCoreControlPointerV1({
        ...valid,
        manifest: {
          ...valid.manifest,
          objectKey: `checkpoints/epoch-2/7/manifest-${DIGEST}.cbor`,
        },
      }),
    ).toThrow(/storage epoch and generation/);
    expect(() =>
      parseLibraryCoreControlPointerV1({
        ...valid,
        manifest: {
          ...valid.manifest,
          objectKey: `checkpoints/epoch-1/8/manifest-${DIGEST}.cbor`,
        },
      }),
    ).toThrow(/storage epoch and generation/);
    expect(() =>
      parseLibraryCoreControlPointerV1({
        ...valid,
        manifest: {
          ...valid.manifest,
          objectKey: `backups/backup-1/manifest-${DIGEST}.cbor`,
        },
      }),
    ).toThrow(/storage epoch and generation/);
  });

  it("rejects accessors and unknown descriptor fields before reading them", () => {
    let accessed = false;
    const descriptor = {
      objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
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
        objectKey: `checkpoints/epoch-1/7/manifest-${DIGEST}.cbor`,
        contentDigest: DIGEST,
        byteLength: 4_096,
        etag: "provider-owned",
      }),
    ).toThrow(/unknown or missing/);
  });
});
