import { createHash, webcrypto } from "node:crypto";

import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreImmutableObjectDescriptorV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreControlCompareAndSwapResultV1,
  LibraryCoreControlReadV1,
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
  LibraryCorePublishedImmutableObjectReceiptV1,
} from "@freed/sync/cloud/library-core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import {
  createLibraryServiceGoogleDrivePublicationV1,
  type LibraryServiceGoogleDrivePublicationStateV1,
} from "./google-drive-publication.js";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  }
});

const libraryId = "a".repeat(64);
const authorityEpoch = "b".repeat(64);
const writerId = "c".repeat(64);
const frontier = "d".repeat(64);

const record = createLibraryCoreNormalizedCheckpointRecordV2({
  registryKey: "00_checkpoint_header",
  primaryKey: "checkpoint",
  payload: {
    authorityEpoch,
    checkpointId: `${libraryId}:${authorityEpoch}:7`,
    createdAtMs: 1_000,
    libraryId,
    schemaVersion: 1,
    sourceRevision: 7,
  },
});

function descriptor(writer = writerId) {
  return Object.freeze({
    authorityEpoch,
    causalFrontierDigest: frontier,
    format: "freed_normalized_checkpoint_export_v2",
    itemCount: 0,
    libraryId,
    protocolVersion: 2,
    recordCount: 1,
    sourceRevision: 7,
    writerId: writer,
  });
}

class MemoryAdapter implements LibraryCoreImmutablePublicationAdapterV1<Uint8Array> {
  readonly objects = new Map<
    string,
    {
      readonly bytes: Uint8Array;
      readonly descriptor: LibraryCoreImmutableObjectDescriptorV1;
    }
  >();
  control: LibraryCoreControlReadV1 = {
    revision: "control-0",
    bytes: new TextEncoder().encode("{}"),
  };

  async readControl(): Promise<LibraryCoreControlReadV1> {
    return {
      revision: this.control.revision,
      bytes: this.control.bytes?.slice() ?? null,
    };
  }

  async putImmutable(
    object: LibraryCorePreparedImmutableObjectV1<Uint8Array>,
  ): Promise<{ readonly transportObjectId: string }> {
    const id = `object-${(this.objects.size + 1).toLocaleString("en-US", { useGrouping: false })}`;
    this.objects.set(id, {
      bytes: object.source.slice(),
      descriptor: object.descriptor,
    });
    return { transportObjectId: id };
  }

  async verifyImmutable(
    receipt: LibraryCorePublishedImmutableObjectReceiptV1,
  ): Promise<LibraryCoreImmutableObjectDescriptorV1> {
    const stored = this.objects.get(receipt.transportObjectId);
    if (stored === undefined) throw new Error("missing object");
    return parseLibraryCoreImmutableObjectDescriptorV1({
      ...stored.descriptor,
      byteLength: stored.bytes.byteLength,
      contentDigest: createHash("sha256").update(stored.bytes).digest("hex"),
    });
  }

  async compareAndSwapControl(input: {
    readonly expectedRevision: string | null;
    readonly bytes: Uint8Array;
  }): Promise<LibraryCoreControlCompareAndSwapResultV1> {
    if (input.expectedRevision !== this.control.revision) {
      return { status: "conflict", current: await this.readControl() };
    }
    this.control = { revision: "control-1", bytes: input.bytes.slice() };
    return { status: "committed", revision: "control-1" };
  }
}

function native(checkpoint = descriptor()): LibraryCoreNativeCommandClientV1 {
  return {
    execute: vi.fn(async (commandId: string) => {
      if (commandId === "describe_checkpoint_export_v2") return checkpoint;
      if (commandId === "begin_checkpoint_export_v2") return checkpoint;
      if (commandId === "export_checkpoint_page_v2") {
        return {
          canonicalRecordBytes:
            encodeLibraryCoreNormalizedCheckpointRecordV2(record).byteLength,
          done: true,
          nextCursor: null,
          records: [record],
        };
      }
      throw new Error(`unexpected command ${commandId}`);
    }),
  } as LibraryCoreNativeCommandClientV1;
}

describe("headless Google Drive checkpoint publication", () => {
  it("publishes bounded native records and persists only the committed receipt", async () => {
    const adapter = new MemoryAdapter();
    let state: LibraryServiceGoogleDrivePublicationStateV1 | null = null;
    const publication = createLibraryServiceGoogleDrivePublicationV1({
      state: {
        read: async () => state,
        write: async (next) => {
          state = next;
        },
      },
      token: { accessToken: async () => "access-token" },
      transport: {
        provision: async () => ({ controlFileId: "control-file" }),
        adapter: () => adapter,
      },
    });
    const client = native();

    await expect(
      publication.publish({
        native: client,
        reason: "initial",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ status: "published", revision: 7 });

    expect(state).toEqual({
      schemaVersion: 1,
      libraryId,
      authorityEpoch,
      writerId,
      controlFileId: "control-file",
      controlRevision: "control-1",
      lastPublishedRevision: 7,
    });
    expect(adapter.objects.size).toBeGreaterThan(1);
    expect(
      (client.execute as ReturnType<typeof vi.fn>).mock.calls.map(
        ([commandId]) => commandId,
      ),
    ).toEqual([
      "describe_checkpoint_export_v2",
      "begin_checkpoint_export_v2",
      "export_checkpoint_page_v2",
    ]);
    await expect(publication.lastPublishedRevision()).resolves.toBe(7);
  });

  it("returns ownership_required without exporting when Drive names another writer", async () => {
    const adapter = new MemoryAdapter();
    const remotePublication = createLibraryServiceGoogleDrivePublicationV1({
      state: { read: async () => null, write: async () => undefined },
      token: { accessToken: async () => "access-token" },
      transport: {
        provision: async () => ({ controlFileId: "control-file" }),
        adapter: () => adapter,
      },
    });
    await remotePublication.publish({
      native: native(descriptor("f".repeat(64))),
      reason: "initial",
      signal: new AbortController().signal,
    });
    const objectCountAfterRemotePublication = adapter.objects.size;
    const publication = createLibraryServiceGoogleDrivePublicationV1({
      state: { read: async () => null, write: async () => undefined },
      token: { accessToken: async () => "access-token" },
      transport: {
        provision: async () => ({ controlFileId: "control-file" }),
        adapter: () => adapter,
      },
    });
    const client = native();

    await expect(
      publication.publish({
        native: client,
        reason: "inbound_refresh",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      status: "ownership_required",
      currentWriterId: "f".repeat(64),
      localWriterId: writerId,
    });
    expect(client.execute).toHaveBeenCalledTimes(1);
    expect(adapter.objects.size).toBe(objectCountAfterRemotePublication);
  });
});
