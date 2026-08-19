import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";

const mocks = vi.hoisted(() => ({
  nativeState: null as unknown,
  controlRead: {
    revision: '"etag-1"',
    bytes: new TextEncoder().encode("{}"),
  },
  publishRequest: null as Record<string, unknown> | null,
  publishStatus: "committed" as "committed" | "recovered_after_response_loss",
  reassignRequest: null as Record<string, unknown> | null,
  readDescriptor: vi.fn(),
  readPage: vi.fn(),
  beginPortableImport: vi.fn(async () => {}),
  appendPortableItems: vi.fn(async () => {}),
  finalizePortableImport: vi.fn(async () => ({ active: true })),
  createBackup: vi.fn(async () => ({ backupId: "backup-before-cloud-import" })),
  restoreBackup: vi.fn(async () => ({})),
  clearSqliteLibrary: vi.fn(async () => {}),
  acceptActorEnrollment: vi.fn(async () => ({})),
  acknowledgeIntentResults: vi.fn(async () => {}),
  readIntentResults: vi.fn(async () => []),
  reassignNative: vi.fn(async () => ({
    authority: {
      library_id: "ab".repeat(32),
      epoch: 2,
      epoch_id: "89".repeat(32),
      authority_key_id: "de".repeat(32),
      authority_public_key: "ef".repeat(32),
      observed_frontier: [],
    },
    actor: {
      actor_id: "12".repeat(32),
      actor_public_key: "23".repeat(32),
      enrollment_operation_id: "actor-enrolled:fixture",
      enrollment_certificate_digest: "44".repeat(32),
      canonical_enrollment_certificate_json: "{}",
      actor_chain_genesis: "45".repeat(32),
    },
    canonicalEpochCertificateJson: "{}",
  })),
  bootstrapAuthority: {
    authority: {
      library_id: "ab".repeat(32),
      epoch: 1,
      epoch_id: "cd".repeat(32),
      authority_key_id: "de".repeat(32),
      authority_public_key: "ef".repeat(32),
      observed_frontier: [],
    },
    actor: {
      actor_id: "12".repeat(32),
      actor_public_key: "23".repeat(32),
      enrollment_operation_id: "actor-enrolled:fixture",
      enrollment_certificate_digest:
        "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      canonical_enrollment_certificate_json: "{}",
      actor_chain_genesis: "45".repeat(32),
    },
  },
  writeNative: vi.fn(),
  setWriterAdmission: vi.fn(async () => ({ configured: true, allowed: true })),
  publish: vi.fn(),
  reassign: vi.fn(),
  importCheckpoint: vi.fn(),
}));

vi.mock("./native-json-store", () => ({
  readNativeJsonValue: vi.fn(async () => mocks.nativeState),
  writeNativeJsonValue: mocks.writeNative.mockImplementation(
    async (_file: string, _key: string, value: unknown) => {
      mocks.nativeState = value;
    },
  ),
}));

vi.mock("./sqlite-library", () => ({
  acknowledgePwaIntentResultOutbox: mocks.acknowledgeIntentResults,
  acceptPwaActorEnrollmentRequest: mocks.acceptActorEnrollment,
  appendPortableSqliteLibraryItems: mocks.appendPortableItems,
  beginPortableSqliteLibraryImport: mocks.beginPortableImport,
  bootstrapSqliteLibraryAuthority: vi.fn(async () => mocks.bootstrapAuthority),
  clearSqliteLibrary: mocks.clearSqliteLibrary,
  createSqliteLibraryBackup: mocks.createBackup,
  finalizePortableSqliteLibraryImport: mocks.finalizePortableImport,
  listSqliteLibraryActorEnrollments: vi.fn(async () => [
    {
      actor_id: mocks.bootstrapAuthority.actor.actor_id,
      accepted_sequence: 0,
      accepted_operation_id: null,
      accepted_chain_digest: mocks.bootstrapAuthority.actor.actor_chain_genesis,
      enrollment_certificate_digest:
        mocks.bootstrapAuthority.actor.enrollment_certificate_digest,
      retired: false,
      retirement_certificate_digest: null,
      canonical_enrollment_certificate_json: "{}",
    },
  ]),
  readSqliteLibrarySyncDescriptor: mocks.readDescriptor,
  readSqliteLibrarySyncPage: mocks.readPage,
  readPwaIntentResultOutbox: mocks.readIntentResults,
  reassignSqliteLibraryWriterEpoch: mocks.reassignNative,
  restoreSqliteLibraryBackup: mocks.restoreBackup,
  setSqliteLibraryCloudWriterAdmission: mocks.setWriterAdmission,
  sqliteLibraryStatus: vi.fn(async () => ({ active: true, revision: 7 })),
}));

vi.mock("@freed/sync/cloud/library-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@freed/sync/cloud/library-core")>();
  const publicationResult = (
    request: Record<string, unknown>,
    entries: readonly unknown[],
  ) => {
    const header = request.header as Record<string, unknown>;
    const generation = Number(request.generation);
    const libraryId = String(header.library_id);
    const storageEpoch = String(header.epoch_id);
    const digest = "67".repeat(32) as LibraryCoreLowercaseHex64;
    const manifest = {
      descriptor: {
        byteLength: 123,
        contentDigest: digest,
        objectKey: createLibraryCoreImmutableObjectKey({
          digest,
          epochId: storageEpoch,
          generation,
          kind: "checkpoint_manifest",
          libraryId,
        }),
      },
      transportObjectId: `manifest-${generation.toLocaleString("en-US")}`,
    };
    return {
      status: mocks.publishStatus,
      revision: '"etag-2"',
      dependencies: [],
      manifest,
      controlPointer: {
        activeTransport: "google_drive_app_data_v1",
        causalFrontierDigest: String(
          (header.materializer_position as Record<string, unknown>)
            .frontier_digest,
        ),
        generation,
        libraryId,
        manifest,
        protocolVersion: 1,
        schemaVersion: 1,
        storageEpoch,
        writerId: String(request.writerId),
      },
      entries,
    };
  };
  return {
    ...actual,
    discoverGoogleDriveLibraryCoreActorEnrollmentRequestsV1: vi.fn(
      async () => [],
    ),
    provisionGoogleDriveLibraryCoreControlV1: vi.fn(async () => ({
      controlFileId: "control-1",
      created: true,
    })),
    createGoogleDriveLibraryCoreAdapterV1: vi.fn(() => ({
      readControl: vi.fn(async () => mocks.controlRead),
      putImmutable: vi.fn(async () => ({ transportObjectId: "immutable-1" })),
      verifyImmutable: vi.fn(
        async (reference: { descriptor: unknown }) => reference.descriptor,
      ),
    })),
    publishLibraryCorePortableCheckpointV1: mocks.publish.mockImplementation(
      async (request: Record<string, unknown>) => {
        mocks.publishRequest = request;
        const entries: unknown[] = [];
        for await (const entry of request.entries as AsyncIterable<unknown>) {
          entries.push(entry);
        }
        return publicationResult(request, entries);
      },
    ),
    importLibraryCorePortableCheckpointV1:
      mocks.importCheckpoint.mockImplementation(
        async (request: Record<string, unknown>) => {
          const writer = request.writer as {
            beginImport(input: unknown): Promise<unknown>;
            appendPage(
              pageIndex: number,
              records: readonly unknown[],
            ): Promise<void>;
            finalizeImport(input: unknown): Promise<unknown>;
          };
          const header = {
            kind: "logical_checkpoint_header",
            format: "freed_logical_checkpoint_v1",
            library_id: String(request.libraryId),
            epoch: 2,
            epoch_id: String(request.storageEpoch),
            schema_version: 2,
            field_registry_version: 1,
            canonical_codec_version: 1,
            anchor_kind: "accepted_authority",
            accepted_authority: null,
            source_transition_digest: null,
            source_manifest_digest: null,
            transition_candidate_anchor: null,
            promoted_receipt_digests: [],
            materializer_position: {
              frontier_digest: "ef".repeat(32),
              ingest_sequence: 9,
              materialized_digest: "34".repeat(32),
            },
            collection_counts: {
              accepted_frontier: 0,
              quarantined_frontier: 0,
              materialized_rows: 3,
              field_clocks: 0,
              relationships: 0,
              tombstones: 0,
              actor_states: 1,
              receipt_records: 0,
              blob_roots: 0,
              excluded_registry_keys: 0,
            },
          };
          await writer.beginImport({ manifest: {}, manifestReference: {} });
          await writer.appendPage(0, [
            header,
            {
              kind: "logical_checkpoint_entry",
              collection: "materialized_rows",
              ordinal: 0,
              value: {
                primary_key: "shell",
                registry_key: "00_library_shell",
                row: { accounts: {}, feeds: {}, persons: {} },
              },
            },
            {
              kind: "logical_checkpoint_entry",
              collection: "materialized_rows",
              ordinal: 1,
              value: {
                primary_key: "item-1",
                registry_key: "10_feed_items",
                row: { globalId: "item-1", platform: "rss" },
              },
            },
            {
              kind: "logical_checkpoint_entry",
              collection: "materialized_rows",
              ordinal: 2,
              value: {
                primary_key: "item-2",
                registry_key: "10_feed_items",
                row: { globalId: "item-2", platform: "youtube" },
              },
            },
          ]);
          await writer.appendPage(1, [
            {
              kind: "logical_checkpoint_entry",
              collection: "actor_states",
              ordinal: 0,
              value: {
                accepted_chain_digest: "45".repeat(32),
                accepted_operation_id: null,
                accepted_sequence: 0,
                actor_id: "12".repeat(32),
                enrollment_certificate_digest: "44".repeat(32),
                retired: false,
                retirement_certificate_digest: null,
              },
            },
          ]);
          await writer.finalizeImport({
            header,
            manifest: { totalRecordCount: 5 },
          });
          return {
            status: "imported",
            importedPageCount: 1,
            importedRecordCount: 5,
          };
        },
      ),
    reassignLibraryCorePortableCheckpointV1: mocks.reassign.mockImplementation(
      async (request: Record<string, unknown>) => {
        mocks.reassignRequest = request;
        const entries: unknown[] = [];
        for await (const entry of request.entries as AsyncIterable<unknown>) {
          entries.push(entry);
        }
        return publicationResult(request, entries);
      },
    ),
  };
});

import {
  isSqliteLibraryGoogleDriveSyncEnabled,
  makeThisSqliteLibraryDesktopWriter,
  publishCurrentSqliteLibraryToGoogleDrive,
  readSqliteLibraryGoogleDrivePublicationReceipt,
} from "./library-core-cloud-sync";

describe("SQLite Library Google Drive production wiring", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.nativeState = null;
    mocks.controlRead = {
      revision: '"etag-1"',
      bytes: new TextEncoder().encode("{}"),
    };
    mocks.publishRequest = null;
    mocks.publishStatus = "committed";
    mocks.reassignRequest = null;
    mocks.publish.mockClear();
    mocks.reassign.mockClear();
    mocks.reassignNative.mockClear();
    mocks.importCheckpoint.mockClear();
    mocks.beginPortableImport.mockClear();
    mocks.appendPortableItems.mockClear();
    mocks.createBackup.mockClear();
    mocks.restoreBackup.mockClear();
    mocks.clearSqliteLibrary.mockClear();
    mocks.writeNative.mockClear();
    mocks.setWriterAdmission.mockClear();
    mocks.readDescriptor.mockReset().mockResolvedValue({
      revision: 7,
      itemCount: 2,
      sourceDigest: "ab".repeat(32),
      shellJson: '{"accounts":{},"feeds":{},"persons":{}}',
      materializedDigest: "cd".repeat(32),
    });
    mocks.readPage.mockReset().mockResolvedValue({
      revision: 7,
      itemsJson: [
        '{"globalId":"item-1","platform":"rss"}',
        '{"globalId":"item-2","platform":"youtube"}',
      ],
      nextOffset: null,
    });
  });

  it("enables immutable Drive sync by default with an explicit local rollback", () => {
    expect(isSqliteLibraryGoogleDriveSyncEnabled()).toBe(true);
    window.localStorage.setItem(
      "freed.libraryCore.immutableGoogleDriveV1.enabled",
      "0",
    );
    expect(isSqliteLibraryGoogleDriveSyncEnabled()).toBe(false);
  });

  it("rechecks the Desktop role before any publication work begins", async () => {
    window.localStorage.setItem("freed.libraryCore.desktopRoleV1", "follower");

    expect(() =>
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).toThrow("Editable follower sync is not active");

    expect(mocks.readDescriptor).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("streams the exact SQLite revision into one immutable checkpoint publication", async () => {
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    expect(mocks.readPage).toHaveBeenCalledWith({
      revision: 7,
      offset: 0,
    });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const request = mocks.publishRequest;
    expect(request?.generation).toBe(0);
    expect(request?.writerId).toBe(mocks.bootstrapAuthority.actor.actor_id);
    expect(request?.header).toMatchObject({
      collection_counts: { materialized_rows: 3 },
      epoch: 1,
      materializer_position: {
        ingest_sequence: 7,
        materialized_digest: "cd".repeat(32),
      },
      schema_version: 2,
    });
    expect(mocks.nativeState).toMatchObject({
      controlFileId: "control-1",
      lastPublishedRevision: 7,
      lastPublishedCheckpoint: {
        version: 1,
        localRevision: 7,
        itemCount: 2,
        checkpointStoredByteLength: 123,
        controlRevision: '"etag-2"',
        controlPointer: {
          generation: 0,
          manifest: {
            descriptor: { contentDigest: "67".repeat(32) },
            transportObjectId: "manifest-0",
          },
        },
      },
    });
    await expect(
      readSqliteLibraryGoogleDrivePublicationReceipt(),
    ).resolves.toMatchObject({
      localRevision: 7,
      itemCount: 2,
      checkpointStoredByteLength: 123,
      controlRevision: '"etag-2"',
      controlPointer: {
        generation: 0,
        manifest: { transportObjectId: "manifest-0" },
      },
    });
  });

  it("persists the exact receipt after a lost Drive commit response is recovered", async () => {
    mocks.publishStatus = "recovered_after_response_loss";

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    await expect(
      readSqliteLibraryGoogleDrivePublicationReceipt(),
    ).resolves.toMatchObject({
      localRevision: 7,
      itemCount: 2,
      checkpointStoredByteLength: 123,
      controlRevision: '"etag-2"',
      controlPointer: {
        generation: 0,
        manifest: {
          descriptor: { contentDigest: "67".repeat(32) },
          transportObjectId: "manifest-0",
        },
      },
    });
  });

  it("rejects a stored receipt that is not bound to its local revision", async () => {
    await publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" });
    const stored = mocks.nativeState as {
      lastPublishedCheckpoint: Record<string, unknown>;
    };
    mocks.nativeState = {
      ...(mocks.nativeState as Record<string, unknown>),
      lastPublishedCheckpoint: {
        ...stored.lastPublishedCheckpoint,
        localRevision: 8,
      },
    };

    await expect(
      readSqliteLibraryGoogleDrivePublicationReceipt(),
    ).resolves.toBeNull();
  });

  it("replaces an unpublished synthetic empty cloud identity after Library recovery", async () => {
    mocks.nativeState = {
      version: 1,
      libraryId: "empty-library",
      sourceDigest: "0".repeat(64),
      storageEpoch: "empty-epoch",
      writerId: "empty-writer",
      controlFileId: "empty-control",
      lastPublishedRevision: null,
      lastPublishedActorDigest: null,
    };

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.nativeState).toMatchObject({
      libraryId: mocks.bootstrapAuthority.authority.library_id,
      sourceDigest: "ab".repeat(32),
      storageEpoch: mocks.bootstrapAuthority.authority.epoch_id,
      writerId: mocks.bootstrapAuthority.actor.actor_id,
      controlFileId: "control-1",
      lastPublishedRevision: 7,
    });
  });

  it("refuses to replace a mismatched cloud identity that published a revision", async () => {
    mocks.nativeState = {
      version: 1,
      libraryId: "published-library",
      sourceDigest: "0".repeat(64),
      storageEpoch: "published-epoch",
      writerId: "published-writer",
      controlFileId: "published-control",
      lastPublishedRevision: 0,
      lastPublishedActorDigest: null,
    };

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).rejects.toThrow(
      "load local writer authority failed: The saved Library Core cloud identity belongs to another Library",
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.writeNative).not.toHaveBeenCalled();
  });

  it("preserves a native string rejection with its publication stage", async () => {
    mocks.readDescriptor.mockRejectedValueOnce(
      "SQLite Library could not read its authority key",
    );

    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).rejects.toThrow(
      "read local SQLite revision failed: SQLite Library could not read its authority key",
    );
  });

  it("does not queue a fresh publication behind an abandoned native command", async () => {
    const controller = new AbortController();
    mocks.readDescriptor
      .mockReset()
      .mockImplementationOnce(() => new Promise(() => {}));
    const abandoned = publishCurrentSqliteLibraryToGoogleDrive({
      accessToken: "token",
      signal: controller.signal,
    });
    await Promise.resolve();

    mocks.readDescriptor.mockResolvedValue({
      revision: 7,
      itemCount: 2,
      sourceDigest: "ab".repeat(32),
      shellJson: '{"accounts":{},"feeds":{},"persons":{}}',
      materializedDigest: "cd".repeat(32),
    });
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses cloud publication when restored state belongs to another Desktop installation", async () => {
    mocks.nativeState = {
      version: 1,
      libraryId: `library-${"ab".repeat(20)}`,
      sourceDigest: "ab".repeat(32),
      storageEpoch: "epoch-original",
      writerId: "desktop-original-installation",
      controlFileId: "control-1",
      lastPublishedRevision: 6,
    };
    await expect(
      publishCurrentSqliteLibraryToGoogleDrive({ accessToken: "token" }),
    ).resolves.toEqual({
      status: "ownership_required",
      currentWriterId: "desktop-original-installation",
      localWriterId: mocks.bootstrapAuthority.actor.actor_id,
    });

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.writeNative).not.toHaveBeenCalled();
    expect(mocks.setWriterAdmission).toHaveBeenCalledWith(
      expect.objectContaining({
        activeWriterId: "desktop-original-installation",
        localWriterId: mocks.bootstrapAuthority.actor.actor_id,
      }),
    );
  });

  it("moves a current restored SQLite copy to a fresh writer epoch with one control CAS", async () => {
    const libraryId = `library-${"ab".repeat(20)}`;
    mocks.nativeState = {
      version: 1,
      libraryId,
      sourceDigest: "ab".repeat(32),
      storageEpoch: "epoch-original",
      writerId: "desktop-original-installation",
      controlFileId: "control-1",
      lastPublishedRevision: 7,
    };
    mocks.controlRead = {
      revision: '"etag-current"',
      bytes: new Uint8Array(
        encodeLibraryCoreCanonicalValue({
          activeTransport: "google_drive_app_data_v1",
          causalFrontierDigest: "ef".repeat(32),
          generation: 4,
          libraryId,
          manifest: {
            descriptor: {
              byteLength: 123,
              contentDigest: "12".repeat(32),
              objectKey: createLibraryCoreImmutableObjectKey({
                digest: "12".repeat(32) as LibraryCoreLowercaseHex64,
                epochId: "epoch-original",
                generation: 4,
                kind: "checkpoint_manifest",
                libraryId,
              }),
            },
            transportObjectId: "manifest-4",
          },
          protocolVersion: 1,
          schemaVersion: 1,
          storageEpoch: "epoch-original",
          writerId: "desktop-original-installation",
        }),
      ),
    };

    await expect(
      makeThisSqliteLibraryDesktopWriter({ accessToken: "token" }),
    ).resolves.toEqual({ status: "writer_transferred", revision: 7 });

    expect(mocks.reassign).toHaveBeenCalledTimes(1);
    expect(mocks.reassignNative).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId,
        targetWriterId: mocks.bootstrapAuthority.actor.actor_id,
      }),
    );
    expect(mocks.reassignRequest).toMatchObject({
      expectedControl: { revision: '"etag-current"' },
      generation: 0,
      writerId: mocks.bootstrapAuthority.actor.actor_id,
      header: {
        epoch: 2,
        epoch_id: "89".repeat(32),
        materializer_position: { frontier_digest: "ef".repeat(32) },
      },
    });
    expect(mocks.nativeState).toMatchObject({
      lastPublishedRevision: 7,
      writerId: mocks.bootstrapAuthority.actor.actor_id,
    });
    expect(mocks.setWriterAdmission).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeWriterId: mocks.bootstrapAuthority.actor.actor_id,
        localWriterId: mocks.bootstrapAuthority.actor.actor_id,
        controlRevision: '"etag-2"',
      }),
    );
  });

  it("backs up and imports the active cloud checkpoint before taking over from a newer epoch", async () => {
    const libraryId = `library-${"ab".repeat(20)}`;
    mocks.nativeState = {
      version: 1,
      libraryId,
      sourceDigest: "ab".repeat(32),
      storageEpoch: "epoch-original",
      writerId: "desktop-original-installation",
      controlFileId: "control-1",
      lastPublishedRevision: 7,
    };
    mocks.readDescriptor
      .mockReset()
      .mockResolvedValueOnce({
        revision: 8,
        itemCount: 2,
        sourceDigest: "ab".repeat(32),
        shellJson: '{"accounts":{},"feeds":{},"persons":{}}',
        materializedDigest: "cd".repeat(32),
      })
      .mockResolvedValue({
        revision: 1,
        itemCount: 2,
        sourceDigest: "ab".repeat(32),
        shellJson: '{"accounts":{},"feeds":{},"persons":{}}',
        materializedDigest: "34".repeat(32),
      });
    mocks.controlRead = {
      revision: '"etag-current"',
      bytes: new Uint8Array(
        encodeLibraryCoreCanonicalValue({
          activeTransport: "google_drive_app_data_v1",
          causalFrontierDigest: "ef".repeat(32),
          generation: 9,
          libraryId,
          manifest: {
            descriptor: {
              byteLength: 123,
              contentDigest: "56".repeat(32),
              objectKey: createLibraryCoreImmutableObjectKey({
                digest: "56".repeat(32) as LibraryCoreLowercaseHex64,
                epochId: "epoch-cloud-newer",
                generation: 9,
                kind: "checkpoint_manifest",
                libraryId,
              }),
            },
            transportObjectId: "manifest-9",
          },
          protocolVersion: 1,
          schemaVersion: 1,
          storageEpoch: "epoch-cloud-newer",
          writerId: "desktop-cloud-writer",
        }),
      ),
    };

    await expect(
      makeThisSqliteLibraryDesktopWriter({ accessToken: "token" }),
    ).resolves.toEqual({ status: "writer_transferred", revision: 1 });

    expect(mocks.createBackup).toHaveBeenCalledWith("manual");
    expect(mocks.importCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.beginPortableImport).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedItemCount: 2,
        sourceCheckpoint: {
          objectKey: expect.stringContaining("freed-v2-manifest"),
          contentDigest: "56".repeat(32),
          transportObjectId: "manifest-9",
        },
        sourceDigest: "ab".repeat(32),
        sourceRevision: 9,
      }),
    );
    expect(mocks.appendPortableItems).toHaveBeenCalledWith([
      { globalId: "item-1", platform: "rss" },
      { globalId: "item-2", platform: "youtube" },
    ]);
    expect(mocks.reassign).toHaveBeenCalledTimes(1);
    expect(mocks.restoreBackup).not.toHaveBeenCalled();
  });
});
