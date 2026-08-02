import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  migrateLibraryCoreExternalSnapshot,
  tauriLibraryCoreExternalMigrationNativeClient,
  type LibraryCoreExternalExportWorkerClient,
  type LibraryCoreExternalMigrationNativeClient,
} from "./library-core-external-migration-runtime";

const source = {
  schemaVersion: 1 as const,
  storageRevision: { generation: 7, saveRevision: 11 },
  byteLength: 6,
};
const sourceInstallationId = "desktop-installation-1";

const selectedProjection = {
  sourceKey: "a".repeat(64),
  selected: true,
  complete: true,
  nextBatchIndex: 1,
  projectedRows: 1,
  totalRows: 1,
  generationId: "b".repeat(64),
  transitionSequence: 3,
};

function workerClient(): LibraryCoreExternalExportWorkerClient {
  return {
    begin: vi.fn(async (sessionId: string) => ({
      reqId: 1,
      type: "LIBRARY_CORE_EXTERNAL_EXPORT_STARTED" as const,
      sessionId,
      source,
      maximumChunkBytes: 1_048_576,
    })),
    read: vi.fn(async (sessionId: string, offset: number) => {
      const bytes = Uint8Array.from([4, 5, 6]);
      return {
        reqId: 2,
        type: "LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK" as const,
        sessionId,
        source,
        offset,
        nextOffset: offset + bytes.byteLength,
        bytes,
        done: true,
      };
    }),
    confirm: vi.fn(async (sessionId: string) => ({
      reqId: 3,
      type: "LIBRARY_CORE_EXTERNAL_EXPORT_CONFIRMED" as const,
      sessionId,
      source,
    })),
    cancel: vi.fn(async () => {}),
  };
}

describe("Desktop Library Core external migration runtime", () => {
  it("rejects an invalid installation identity before opening either source", async () => {
    const worker = workerClient();
    const native = {
      begin: vi.fn(),
    } as unknown as LibraryCoreExternalMigrationNativeClient;

    await expect(
      migrateLibraryCoreExternalSnapshot(worker, native, "worker-generation-0", "invalid/id"),
    ).rejects.toThrow("source installation identity is invalid");
    expect(worker.begin).not.toHaveBeenCalled();
    expect(native.begin).not.toHaveBeenCalled();
  });

  it("maps the worker revision to the native Tauri wire contract", async () => {
    invokeMock.mockResolvedValueOnce({
      sessionId: "legacy-v1:7:11:6",
      committedOffset: 0,
      byteLength: source.byteLength,
      complete: false,
    });

    await tauriLibraryCoreExternalMigrationNativeClient.begin({
      sessionId: "legacy-v1:7:11:6",
      sourceInstallationId,
      source,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "begin_library_core_external_migration",
      {
        sessionId: "legacy-v1:7:11:6",
        source: {
          schemaVersion: 1,
          storageGeneration: 7,
          storageSaveRevision: 11,
          byteLength: 6,
          sourceInstallationId,
        },
      },
    );
  });

  it("resumes the durable native spool by the exact legacy storage revision", async () => {
    const worker = workerClient();
    const native: LibraryCoreExternalMigrationNativeClient = {
      begin: vi.fn(async ({ sessionId }) => ({
        sessionId,
        committedOffset: 3,
        byteLength: source.byteLength,
        complete: false,
      })),
      append: vi.fn(async ({ sessionId, offset, bytes }) => ({
        sessionId,
        committedOffset: offset + bytes.byteLength,
        byteLength: source.byteLength,
        complete: true,
      })),
      finalize: vi.fn(async () => selectedProjection),
      complete: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    };

    await expect(
      migrateLibraryCoreExternalSnapshot(
        worker,
        native,
        "worker-generation-1",
        sourceInstallationId,
      ),
    ).resolves.toEqual({
      migrated: true,
      projection: selectedProjection,
    });

    expect(native.begin).toHaveBeenCalledWith({
      sessionId: "legacy-v1:7:11:6",
      sourceInstallationId,
      source,
    });
    expect(worker.read).toHaveBeenCalledWith("worker-generation-1", 3);
    expect(native.append).toHaveBeenCalledWith({
      sessionId: "legacy-v1:7:11:6",
      offset: 3,
      bytes: Uint8Array.from([4, 5, 6]),
    });
    expect(native.finalize).toHaveBeenCalledWith("legacy-v1:7:11:6");
    expect(worker.confirm).toHaveBeenCalledWith("worker-generation-1");
    expect(native.complete).toHaveBeenCalledWith("legacy-v1:7:11:6");
    expect(worker.cancel).toHaveBeenCalledWith("worker-generation-1");
    expect(native.cancel).not.toHaveBeenCalled();
  });

  it("replays finalization after response loss without reading the source again", async () => {
    const worker = workerClient();
    const native: LibraryCoreExternalMigrationNativeClient = {
      begin: vi.fn(async ({ sessionId }) => ({
        sessionId,
        committedOffset: source.byteLength,
        byteLength: source.byteLength,
        complete: true,
      })),
      append: vi.fn(),
      finalize: vi.fn(async () => selectedProjection),
      complete: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    };

    await expect(
      migrateLibraryCoreExternalSnapshot(
        worker,
        native,
        "worker-generation-2",
        sourceInstallationId,
      ),
    ).resolves.toEqual({
      migrated: true,
      projection: selectedProjection,
    });

    expect(worker.read).not.toHaveBeenCalled();
    expect(native.append).not.toHaveBeenCalled();
    expect(native.finalize).toHaveBeenCalledWith("legacy-v1:7:11:6");
  });

  it("drops both live handles but preserves the native spool after a bad chunk", async () => {
    const worker = workerClient();
    vi.mocked(worker.read).mockResolvedValueOnce({
      reqId: 2,
      type: "LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK",
      sessionId: "wrong-worker",
      source,
      offset: 0,
      nextOffset: 3,
      bytes: Uint8Array.from([1, 2, 3]),
      done: false,
    });
    const native: LibraryCoreExternalMigrationNativeClient = {
      begin: vi.fn(async ({ sessionId }) => ({
        sessionId,
        committedOffset: 0,
        byteLength: source.byteLength,
        complete: false,
      })),
      append: vi.fn(),
      finalize: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(async () => {}),
    };

    await expect(
      migrateLibraryCoreExternalSnapshot(
        worker,
        native,
        "worker-generation-3",
        sourceInstallationId,
      ),
    ).rejects.toThrow("external export chunk is inconsistent");

    expect(native.cancel).toHaveBeenCalledWith("legacy-v1:7:11:6");
    expect(worker.cancel).toHaveBeenCalledWith("worker-generation-3");
    expect(native.append).not.toHaveBeenCalled();
    expect(native.complete).not.toHaveBeenCalled();
  });
});
