import { createHash, webcrypto } from "node:crypto";

import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreControlPointerV1,
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
import { verifyPreparedWriterCheckpoint } from "./writer-promotion-verification.js";
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

class MemoryAdapter
  implements LibraryCoreImmutablePublicationAdapterV1<Uint8Array>
{
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

function native(checkpoint = descriptor(), exportedRecord = record): LibraryCoreNativeCommandClientV1 {
  return {
    execute: vi.fn(async (commandId: string) => {
      if (commandId === "cloud_writer_clear_v1") return { allowed: false };
      if (commandId === "cloud_writer_observe_v1") return { allowed: true };
      if (commandId === "describe_checkpoint_export_v2") return checkpoint;
      if (commandId === "begin_checkpoint_export_v2") return checkpoint;
      if (commandId === "export_checkpoint_page_v2") {
        return {
          canonicalRecordBytes:
            encodeLibraryCoreNormalizedCheckpointRecordV2(exportedRecord).byteLength,
          done: true,
          nextCursor: null,
          records: [exportedRecord],
        };
      }
      throw new Error(`unexpected command ${commandId}`);
    }),
  } as LibraryCoreNativeCommandClientV1;
}

describe("headless Google Drive checkpoint publication", () => {
  it("clears native admission before token work and leaves it cleared after failure", async () => {
    const client = native();
    const publication = createLibraryServiceGoogleDrivePublicationV1({
      state: { read: async () => null, write: async () => undefined },
      token: { accessToken: async () => { throw new Error("token unavailable"); } },
    });
    await expect(publication.publish({
      native: client, reason: "initial", signal: new AbortController().signal,
    })).rejects.toThrow("token unavailable");
    expect(vi.mocked(client.execute).mock.calls.map(([command]) => command)).toEqual([
      "cloud_writer_clear_v1", "describe_checkpoint_export_v2", "cloud_writer_clear_v1",
    ]);
  });

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
      "cloud_writer_clear_v1",
      "describe_checkpoint_export_v2",
      "begin_checkpoint_export_v2",
      "export_checkpoint_page_v2",
      "cloud_writer_observe_v1",
    ]);
    await expect(publication.lastPublishedRevision()).resolves.toBe(7);

    // A matching writer and epoch cannot substitute for exact transferred content.
    const verification = {
      adapter: {
        async readImmutable(reference: LibraryCorePublishedImmutableObjectReceiptV1) {
          const stored = adapter.objects.get(reference.transportObjectId);
          if (stored === undefined) throw new Error("missing object");
          return stored.bytes.slice();
        },
      },
      pointer: parseLibraryCoreControlPointerV1(JSON.parse(
        new TextDecoder().decode(adapter.control.bytes!),
      )),
      signal: new AbortController().signal,
      subtle: webcrypto.subtle as SubtleCrypto,
    };
    await expect(verifyPreparedWriterCheckpoint({ ...verification, native: client }))
      .resolves.toMatchObject({ recordCount: 1 });
    const changedRecord = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: record.registryKey,
      primaryKey: record.primaryKey,
      payload: { ...record.payload, createdAtMs: 1_001 },
    });
    await expect(verifyPreparedWriterCheckpoint({
      ...verification, native: native(descriptor(), changedRecord),
    })).rejects.toMatchObject({ code: "bound_input_changed" });

    const drifting = native();
    const stableExecute = vi.mocked(drifting.execute).getMockImplementation()!;
    vi.mocked(drifting.execute).mockImplementation(async (command, payload) => {
      if (command === "describe_checkpoint_export_v2") {
        return { ...descriptor(), sourceRevision: 8 };
      }
      return stableExecute(command, payload);
    });
    await expect(verifyPreparedWriterCheckpoint({
      ...verification, native: drifting,
    })).rejects.toMatchObject({ code: "bound_input_changed" });

    const cancelled = native();
    await expect(verifyPreparedWriterCheckpoint({
      ...verification, native: cancelled, signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(cancelled.execute).not.toHaveBeenCalled();
  });

  it("returns ownership_required without exporting when Drive names another writer", async () => {
    const refreshInbound = vi.fn();
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
      refreshInbound,
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
    expect(client.execute).toHaveBeenCalledTimes(3);
    expect(adapter.objects.size).toBe(objectCountAfterRemotePublication);
    expect(refreshInbound).not.toHaveBeenCalled();
  });

  it("checks cloud authority before inbound work and observes its new revision", async () => {
    const adapter = new MemoryAdapter();
    let state: LibraryServiceGoogleDrivePublicationStateV1 | null = null;
    let revision = 7;
    const refreshInbound = vi.fn(async () => {
      revision = 8;
    });
    const publication = createLibraryServiceGoogleDrivePublicationV1({
      refreshInbound,
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
    const originalExecute = client.execute;
    client.execute = vi.fn(async (command: string, payload: unknown) => {
      if (command === "describe_checkpoint_export_v2") {
        return { ...descriptor(), sourceRevision: revision };
      }
      if (command === "begin_checkpoint_export_v2" && revision === 8) {
        // Stop at the export boundary: the distinct contract here is that a
        // successful inbound edit cannot take the stale 'current' shortcut.
        throw new Error("fresh export reached");
      }
      return originalExecute(command as never, payload as never);
    }) as typeof client.execute;
    await publication.publish({
      native: client,
      reason: "initial",
      signal: new AbortController().signal,
    });
    expect(refreshInbound).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    await expect(
      publication.publish({
        native: client,
        reason: "inbound_refresh",
        signal,
      }),
    ).rejects.toThrow("fresh export reached");
    expect(refreshInbound).toHaveBeenCalledExactlyOnceWith({
      accessToken: "access-token",
      controlFileId: "control-file",
      descriptor: descriptor(),
      signal,
    });
  });
});
