import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  libraryCorePortableCheckpointRecordIdentityV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCorePortableCheckpointRecordV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreCheckpointManifestV1,
  type LibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
} from "@freed/shared/library-core";
import {
  type LibraryCoreControlCompareAndSwapResultV1,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutablePublicationAdapterV1,
  type LibraryCoreImmutableReadAdapterV1,
  type LibraryCorePreparedImmutableObjectV1,
  type LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";
import {
  publishLibraryCoreCheckpointGenerationV1,
  type LibraryCorePreparedCheckpointPageV1,
} from "./library-core-checkpoint-publication.js";
import {
  importLibraryCorePortableCheckpointV1,
  prepareLibraryCorePortableCheckpointPagesV1,
  publishLibraryCorePortableCheckpointV1,
  reassignLibraryCorePortableCheckpointV1,
} from "./library-core-portable-checkpoint.js";

const FRONTIER_DIGEST = "ab".repeat(32) as LibraryCoreLowercaseHex64;
const MATERIALIZED_DIGEST = "bc".repeat(32) as LibraryCoreLowercaseHex64;
const SOURCE_TRANSITION_DIGEST = "cd".repeat(32) as LibraryCoreLowercaseHex64;
const SOURCE_MANIFEST_DIGEST = "de".repeat(32) as LibraryCoreLowercaseHex64;
const subtle = webcrypto.subtle as unknown as SubtleCrypto;

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

class FakeCheckpointAdapter
  implements
    LibraryCoreImmutablePublicationAdapterV1<Uint8Array>,
    LibraryCoreImmutableReadAdapterV1
{
  readonly events: string[] = [];
  readonly objects = new Map<
    string,
    {
      readonly bytes: Uint8Array;
      readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
    }
  >();
  control: LibraryCoreControlReadV1 = { revision: null, bytes: null };

  async readControl(): Promise<LibraryCoreControlReadV1> {
    this.events.push("read-control");
    return {
      bytes: this.control.bytes?.slice() ?? null,
      revision: this.control.revision,
    };
  }

  async putImmutable(
    object: LibraryCorePreparedImmutableObjectV1<Uint8Array>,
  ): Promise<{ readonly transportObjectId: string }> {
    this.events.push(`put:${object.descriptor.objectKey}`);
    const transportObjectId = `drive-object-${String(this.objects.size + 1)}`;
    this.objects.set(transportObjectId, {
      bytes: object.source.slice(),
      descriptor: object.descriptor,
    });
    return { transportObjectId };
  }

  async verifyImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<LibraryCoreImmutableObjectDescriptorV1> {
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing fake immutable object");
    return parseLibraryCoreImmutableObjectDescriptorV1({
      byteLength: stored.bytes.byteLength,
      contentDigest: digest(stored.bytes),
      objectKey: stored.descriptor.objectKey,
    });
  }

  async compareAndSwapControl(input: {
    readonly expectedRevision: string | null;
    readonly bytes: Uint8Array;
  }): Promise<LibraryCoreControlCompareAndSwapResultV1> {
    if (input.expectedRevision !== this.control.revision) {
      return { current: await this.readControl(), status: "conflict" };
    }
    this.control = { bytes: input.bytes.slice(), revision: "revision-1" };
    return { revision: "revision-1", status: "committed" };
  }

  async readImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<Uint8Array> {
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing fake immutable object");
    return stored.bytes.slice();
  }
}

function header(
  materializedRows: number,
  epochId = "epoch-1",
): LibraryCorePortableCheckpointHeaderV1 {
  const parsed = parseLibraryCorePortableCheckpointRecordV1({
    anchor_kind: "accepted_authority",
    accepted_authority: null,
    canonical_codec_version: 1,
    collection_counts: {
      accepted_frontier: 0,
      actor_states: 0,
      blob_roots: 0,
      excluded_registry_keys: 0,
      field_clocks: 0,
      materialized_rows: materializedRows,
      quarantined_frontier: 0,
      receipt_records: 0,
      relationships: 0,
      tombstones: 0,
    },
    epoch: 1,
    epoch_id: epochId,
    field_registry_version: 1,
    format: "freed_logical_checkpoint_v1",
    kind: "logical_checkpoint_header",
    library_id: "library-1",
    materializer_position: {
      frontier_digest: FRONTIER_DIGEST,
      ingest_sequence: 0,
      materialized_digest: MATERIALIZED_DIGEST,
    },
    promoted_receipt_digests: [],
    schema_version: 1,
    source_manifest_digest: SOURCE_MANIFEST_DIGEST,
    source_transition_digest: SOURCE_TRANSITION_DIGEST,
    transition_candidate_anchor: null,
  });
  if (parsed.kind !== "logical_checkpoint_header") {
    throw new TypeError("portable checkpoint test header is invalid");
  }
  return parsed;
}

function epochCertificateObject(
  epochId: string,
): LibraryCorePreparedImmutableObjectV1<Uint8Array> {
  const source = new TextEncoder().encode(
    JSON.stringify({ kind: "writer_epoch_certificate", epochId }),
  );
  const contentDigest = digest(source) as LibraryCoreLowercaseHex64;
  return {
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      byteLength: source.byteLength,
      contentDigest,
      objectKey: createLibraryCoreImmutableObjectKey({
        digest: contentDigest,
        epochId,
        kind: "epoch_certificate",
        libraryId: "library-1",
      }),
    }),
    source,
  };
}

function materializedRows(
  count: number,
): LibraryCorePortableCheckpointEntryV1[] {
  return Array.from({ length: count }, (_, ordinal) => {
    const primaryKey = `item-${String(ordinal).padStart(6, "0")}`;
    return {
      collection: "materialized_rows",
      kind: "logical_checkpoint_entry",
      ordinal,
      value: {
        primary_key: primaryKey,
        registry_key: "feedItems",
        row: { globalId: primaryKey, saved: ordinal % 2 === 0 },
      },
    };
  });
}

describe("Library Core portable checkpoint", () => {
  it("publishes the first pointer into a provisioned empty CAS control", async () => {
    const adapter = new FakeCheckpointAdapter();
    adapter.control = {
      revision: '"empty-control-etag"',
      bytes: new TextEncoder().encode("{}"),
    };
    const rows = materializedRows(1);

    const published = await publishLibraryCorePortableCheckpointV1({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      entries: rows,
      expectedControl: {
        pointer: null,
        revision: '"empty-control-etag"',
      },
      generation: 0,
      header: header(rows.length),
      subtle,
      writerId: "desktop-1",
    });

    expect(published.status).toBe("committed");
    expect(adapter.control.revision).toBe("revision-1");
  });

  it("publishes generation zero and changes authority only through the exact control CAS", async () => {
    const adapter = new FakeCheckpointAdapter();
    const rows = materializedRows(1);
    const initial = await publishLibraryCorePortableCheckpointV1({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      entries: rows,
      expectedControl: { pointer: null, revision: null },
      generation: 0,
      header: header(rows.length),
      subtle,
      writerId: "desktop-1",
    });
    if (initial.status === "conflict") {
      throw new Error("initial checkpoint publication unexpectedly conflicted");
    }

    const reassigned = await reassignLibraryCorePortableCheckpointV1({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      entries: rows,
      epochCertificate: epochCertificateObject("epoch-2"),
      expectedControl: {
        pointer: initial.controlPointer,
        revision: initial.revision,
      },
      generation: 0,
      header: header(rows.length, "epoch-2"),
      subtle,
      writerId: "desktop-2",
    });

    expect(reassigned).toMatchObject({
      status: "committed",
      controlPointer: {
        generation: 0,
        storageEpoch: "epoch-2",
        writerId: "desktop-2",
      },
    });
    if (reassigned.status === "conflict") {
      throw new Error("writer reassignment unexpectedly conflicted");
    }
    expect(reassigned.dependencies[0]?.descriptor.objectKey).toMatch(
      /^freed-v2-epoch~/,
    );
  });

  it("publishes and imports a complete logical checkpoint through bounded pages", async () => {
    const adapter = new FakeCheckpointAdapter();
    const rows = materializedRows(130);
    const published = await publishLibraryCorePortableCheckpointV1({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      entries: rows,
      expectedControl: { pointer: null, revision: null },
      generation: 0,
      header: header(rows.length),
      subtle,
      writerId: "desktop-1",
    });
    if (published.status === "conflict") {
      throw new Error(
        "portable checkpoint publication unexpectedly conflicted",
      );
    }
    expect(published.dependencies).toHaveLength(2);

    const staged: LibraryCorePortableCheckpointRecordV1[] = [];
    const pageSizes: number[] = [];
    let finalized = false;
    const imported = await importLibraryCorePortableCheckpointV1({
      adapter,
      generation: 0,
      libraryId: "library-1",
      manifest: published.manifest,
      storageEpoch: "epoch-1",
      subtle,
      writer: {
        async appendPage(_pageIndex, records) {
          pageSizes.push(records.length);
          staged.push(...records);
        },
        async beginImport() {
          return "import";
        },
        async finalizeImport() {
          finalized = true;
          return {
            frontierDigest: FRONTIER_DIGEST,
            ingestSequence: 0,
            libraryId: "library-1",
            materializedDigest: MATERIALIZED_DIGEST,
            recordCount: 131,
            storageEpoch: "epoch-1",
          };
        },
      },
    });

    expect(pageSizes).toEqual([128, 3]);
    expect(staged).toHaveLength(131);
    expect(staged[0]?.kind).toBe("logical_checkpoint_header");
    expect(staged.at(-1)).toMatchObject({
      collection: "materialized_rows",
      ordinal: 129,
    });
    expect(imported).toMatchObject({
      importedPageCount: 2,
      importedRecordCount: 131,
      status: "imported",
    });
    expect(imported.header?.materializer_position.frontier_digest).toBe(
      FRONTIER_DIGEST,
    );
    expect(finalized).toBe(true);
  });

  it("rejects an out-of-order logical collection before uploading a page", async () => {
    const adapter = new FakeCheckpointAdapter();
    const rows = materializedRows(2);
    const outOfOrder = [{ ...rows[0]!, ordinal: 1 }, rows[1]!];

    await expect(
      publishLibraryCorePortableCheckpointV1({
        activeTransport: "google_drive_app_data_v1",
        adapter,
        entries: outOfOrder,
        expectedControl: { pointer: null, revision: null },
        generation: 0,
        header: header(2),
        subtle,
        writerId: "desktop-1",
      }),
    ).rejects.toThrow(/contiguous ordinals/);
    expect(adapter.events).toEqual(["read-control"]);
  });

  it("aborts when a row store cannot prove the staged materialized state", async () => {
    const adapter = new FakeCheckpointAdapter();
    const published = await publishLibraryCorePortableCheckpointV1({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      entries: materializedRows(1),
      expectedControl: { pointer: null, revision: null },
      generation: 0,
      header: header(1),
      subtle,
      writerId: "desktop-1",
    });
    if (published.status === "conflict") {
      throw new Error(
        "portable checkpoint publication unexpectedly conflicted",
      );
    }
    let aborted = false;
    await expect(
      importLibraryCorePortableCheckpointV1({
        adapter,
        generation: 0,
        libraryId: "library-1",
        manifest: published.manifest,
        storageEpoch: "epoch-1",
        subtle,
        writer: {
          async abortImport() {
            aborted = true;
          },
          async appendPage() {},
          async beginImport() {
            return "import";
          },
          async finalizeImport() {
            return {
              frontierDigest: FRONTIER_DIGEST,
              ingestSequence: 0,
              libraryId: "library-1",
              materializedDigest: "ff".repeat(32) as LibraryCoreLowercaseHex64,
              recordCount: 2,
              storageEpoch: "epoch-1",
            };
          },
        },
      }),
    ).rejects.toThrow(/staging receipt does not match/);
    expect(aborted).toBe(true);
  });

  it("aborts staged rows when the logical header disagrees with the authenticated manifest frontier", async () => {
    const adapter = new FakeCheckpointAdapter();
    const rows = materializedRows(1);
    const pages: LibraryCorePreparedCheckpointPageV1[] = [];
    for await (const page of prepareLibraryCorePortableCheckpointPagesV1({
      entries: rows,
      generation: 0,
      header: header(1),
      subtle,
    })) {
      pages.push(page);
    }
    const published = await publishLibraryCoreCheckpointGenerationV1({
      activeTransport: "google_drive_app_data_v1",
      adapter,
      causalFrontierDigest: "ef".repeat(32) as LibraryCoreLowercaseHex64,
      datasetSchemaId: "library_core_logical_checkpoint_v1",
      expectedControl: { pointer: null, revision: null },
      generation: 0,
      libraryId: "library-1",
      pages,
      parseRecord: parseLibraryCorePortableCheckpointRecordV1,
      recordIdentity: libraryCorePortableCheckpointRecordIdentityV1,
      storageEpoch: "epoch-1",
      subtle,
      writerId: "desktop-1",
    });
    if (published.status === "conflict") {
      throw new Error(
        "portable checkpoint publication unexpectedly conflicted",
      );
    }

    let aborted = false;
    let finalized = false;
    await expect(
      importLibraryCorePortableCheckpointV1({
        adapter,
        generation: 0,
        libraryId: "library-1",
        manifest: published.manifest,
        storageEpoch: "epoch-1",
        subtle,
        writer: {
          async abortImport() {
            aborted = true;
          },
          async appendPage() {},
          async beginImport(_input: {
            readonly manifest: LibraryCoreCheckpointManifestV1;
            readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
          }) {
            return "import";
          },
          async finalizeImport() {
            finalized = true;
            return {
              frontierDigest: FRONTIER_DIGEST,
              ingestSequence: 0,
              libraryId: "library-1",
              materializedDigest: MATERIALIZED_DIGEST,
              recordCount: 2,
              storageEpoch: "epoch-1",
            };
          },
        },
      }),
    ).rejects.toThrow(/header does not match/);
    expect(aborted).toBe(true);
    expect(finalized).toBe(false);
  });
});
