import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { importLibraryCoreCheckpointManifestV1 } from "./library-core-checkpoint-import.js";
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
  type PublishLibraryCoreCheckpointGenerationRequestV1,
} from "./library-core-checkpoint-publication.js";
import { encodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

interface TestRecord {
  readonly [key: string]: LibraryCoreCanonicalValue;
  readonly id: string;
  readonly value: string;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseRecord(value: LibraryCoreCanonicalValue): TestRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("checkpoint test record must be a plain record");
  }
  const record = value as Record<string, LibraryCoreCanonicalValue>;
  if (
    Object.keys(record).sort().join(",") !== "id,value" ||
    typeof record.id !== "string" ||
    typeof record.value !== "string"
  ) {
    throw new TypeError("checkpoint test record is invalid");
  }
  return Object.freeze({ id: record.id, value: record.value });
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
      revision: this.control.revision,
      bytes: this.control.bytes?.slice() ?? null,
    };
  }

  async putImmutable(
    object: LibraryCorePreparedImmutableObjectV1<Uint8Array>,
  ): Promise<{ readonly transportObjectId: string }> {
    this.events.push(`put:${object.descriptor.objectKey}`);
    const transportObjectId = `drive-object-${(
      this.objects.size + 1
    ).toLocaleString("en-US", { useGrouping: false })}`;
    this.objects.set(transportObjectId, {
      bytes: object.source.slice(),
      descriptor: object.descriptor,
    });
    return { transportObjectId };
  }

  async verifyImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<LibraryCoreImmutableObjectDescriptorV1> {
    this.events.push(`verify:${receipt.descriptor.objectKey}`);
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing fake immutable object");
    return parseLibraryCoreImmutableObjectDescriptorV1({
      objectKey: stored.descriptor.objectKey,
      contentDigest: digest(stored.bytes),
      byteLength: stored.bytes.byteLength,
    });
  }

  async compareAndSwapControl(input: {
    readonly expectedRevision: string | null;
    readonly bytes: Uint8Array;
  }): Promise<LibraryCoreControlCompareAndSwapResultV1> {
    this.events.push("compare-and-swap-control");
    if (input.expectedRevision !== this.control.revision) {
      return { status: "conflict", current: await this.readControl() };
    }
    this.control = { revision: "revision-1", bytes: input.bytes.slice() };
    return { status: "committed", revision: "revision-1" };
  }

  async readImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<Uint8Array> {
    this.events.push(`read:${receipt.transportObjectId}`);
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing fake immutable object");
    return stored.bytes.slice();
  }
}

async function checkpointPage(
  pageIndex: number,
  records: readonly TestRecord[],
): Promise<LibraryCorePreparedCheckpointPageV1> {
  const source = await encodeLibraryCoreWireObjectV1(records, {
    kind: "checkpoint",
    maximumDecodedBytes: 2_097_152,
    maximumRecordBytes: 131_072,
    maximumRecords: 128,
    recordIdentity(value) {
      return parseRecord(value).id;
    },
  });
  const contentDigest = digest(source);
  return {
    firstRecordIdentity: records[0]!.id,
    lastRecordIdentity: records.at(-1)!.id,
    object: {
      descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: createLibraryCoreImmutableObjectKey({
          kind: "checkpoint_page",
          libraryId: "library-1",
          epochId: "epoch-1",
          generation: 0,
          pageIndex,
          digest: contentDigest,
        }),
        contentDigest,
        byteLength: source.byteLength,
      }),
      source,
    },
    pageIndex,
    recordCount: records.length,
  };
}

function publishRequest(
  adapter: FakeCheckpointAdapter,
  pages: PublishLibraryCoreCheckpointGenerationRequestV1<TestRecord>["pages"],
) {
  return {
    activeTransport: "google_drive_app_data_v1" as const,
    adapter,
    causalFrontierDigest: "fe".repeat(32) as LibraryCoreLowercaseHex64,
    datasetSchemaId: "library_core_feed_card_projection_v1" as const,
    expectedControl: { revision: null, pointer: null },
    generation: 0,
    libraryId: "library-1",
    pages,
    parseRecord,
    recordIdentity(record: TestRecord) {
      return record.id;
    },
    storageEpoch: "epoch-1",
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
    writerId: "desktop-1",
  };
}

describe("Library Core checkpoint publication", () => {
  it("publishes verified pages, constructs their exact manifest, and round-trips through the bounded importer", async () => {
    const adapter = new FakeCheckpointAdapter();
    const pages = [
      await checkpointPage(0, [
        { id: "item-1", value: "one" },
        { id: "item-2", value: "two" },
      ]),
      await checkpointPage(1, [
        { id: "item-3", value: "three" },
        { id: "item-4", value: "four" },
      ]),
    ];

    async function* streamedPages() {
      yield pages[0]!;
      expect(adapter.objects.size).toBe(1);
      yield pages[1]!;
    }
    const published = await publishLibraryCoreCheckpointGenerationV1(
      publishRequest(adapter, streamedPages()),
    );
    if (published.status === "conflict") {
      throw new Error("checkpoint publication unexpectedly conflicted");
    }

    expect(
      published.dependencies.map((receipt) => receipt.transportObjectId),
    ).toEqual(["drive-object-1", "drive-object-2"]);
    expect(published.manifest.transportObjectId).toBe("drive-object-3");
    expect(published.controlPointer.manifest).toEqual(published.manifest);
    expect(adapter.events.slice(0, 8)).toEqual([
      "read-control",
      expect.stringMatching(/^put:freed-v2-checkpoint~/),
      expect.stringMatching(/^verify:freed-v2-checkpoint~/),
      expect.stringMatching(/^put:freed-v2-checkpoint~/),
      expect.stringMatching(/^verify:freed-v2-checkpoint~/),
      expect.stringMatching(/^put:freed-v2-manifest~/),
      expect.stringMatching(/^verify:freed-v2-manifest~/),
      "compare-and-swap-control",
    ]);

    const imported: TestRecord[] = [];
    await expect(
      importLibraryCoreCheckpointManifestV1({
        adapter,
        datasetSchemaId: "library_core_feed_card_projection_v1",
        generation: 0,
        libraryId: "library-1",
        manifest: published.manifest,
        async onPage(_pageIndex, records) {
          imported.push(...records);
        },
        parseRecord,
        recordIdentity(record) {
          return record.id;
        },
        storageEpoch: "epoch-1",
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
      }),
    ).resolves.toEqual({
      causalFrontierDigest: "fe".repeat(32),
      importedPageCount: 2,
      importedRecordCount: 4,
      status: "imported",
    });
    expect(imported).toEqual([
      { id: "item-1", value: "one" },
      { id: "item-2", value: "two" },
      { id: "item-3", value: "three" },
      { id: "item-4", value: "four" },
    ]);
  });

  it("rejects invalid page metadata before uploading that immutable object", async () => {
    const adapter = new FakeCheckpointAdapter();
    const page = await checkpointPage(0, [
      { id: "item-1", value: "one" },
      { id: "item-2", value: "two" },
    ]);
    const pages = [{ ...page, firstRecordIdentity: "item-2" }];

    await expect(
      publishLibraryCoreCheckpointGenerationV1(publishRequest(adapter, pages)),
    ).rejects.toThrow(/identity range/);
    expect(adapter.events).toEqual(["read-control"]);
  });

  it("rejects corrupt or out-of-order prepared page bytes before uploading them", async () => {
    const corrupt = await checkpointPage(0, [{ id: "item-1", value: "one" }]);
    corrupt.object.source[corrupt.object.source.byteLength - 1] ^= 0xff;
    const outOfOrder = await checkpointPage(0, [
      { id: "item-1", value: "one" },
      { id: "item-3", value: "three" },
      { id: "item-2", value: "two" },
    ]);

    for (const [page, expected] of [
      [corrupt, /digest does not match/],
      [outOfOrder, /strictly increasing/],
    ] as const) {
      const adapter = new FakeCheckpointAdapter();
      await expect(
        publishLibraryCoreCheckpointGenerationV1(
          publishRequest(adapter, [page]),
        ),
      ).rejects.toThrow(expected);
      expect(adapter.events).toEqual(["read-control"]);
    }
  });
});
