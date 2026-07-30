import { describe, expect, it, vi } from "vitest";
import type {
  LibraryCoreProjectionBatchV1,
  LibraryCoreProjectionSourceV1,
} from "./automerge-types";
import {
  projectLibraryCoreShadow,
  type LibraryCoreProjectionStartedV1,
  type LibraryCoreProjectionWorkerClient,
  type LibraryCoreShadowNativeClient,
  type LibraryCoreShadowProjectionStatus,
} from "./library-core-shadow-runtime";

const source: LibraryCoreProjectionSourceV1 = {
  schemaVersion: 1,
  documentId: "doc",
  headsDigest: "a".repeat(64),
  headCount: 1,
  storageRevision: { generation: 2, saveRevision: 3 },
};

function status(
  overrides: Partial<LibraryCoreShadowProjectionStatus> = {},
): LibraryCoreShadowProjectionStatus {
  return {
    sourceKey: "b".repeat(64),
    selected: false,
    complete: false,
    nextBatchIndex: 0,
    projectedRows: 0,
    totalRows: 2,
    generationId: null,
    transitionSequence: null,
    ...overrides,
  };
}

function started(totalRows = 2): LibraryCoreProjectionStartedV1 {
  return {
    reqId: 1,
    type: "LIBRARY_CORE_PROJECTION_STARTED",
    sessionId: "session",
    source,
    totalRows,
    nextBatchIndex: 0,
    projectedRows: 0,
    maximumBatchRows: 1_000,
    maximumBatchBytes: 4 * 1_048_576,
  };
}

function batch(batchIndex: number, done: boolean): LibraryCoreProjectionBatchV1 {
  return {
    sessionId: "session",
    source,
    batchIndex,
    rows: [
      {
        globalId: `item-${batchIndex.toLocaleString()}`,
        platform: "rss",
        contentType: "article",
        publishedAt: 1,
        capturedAt: 2,
        authorId: null,
        authorDisplayName: null,
        authorHandle: null,
        sourceUrl: null,
        hidden: 0,
        saved: 0,
        archived: 0,
        readAt: null,
        archivedAt: null,
        likedAt: null,
        tags: "[]",
        contentBlob: null,
        preservedBlob: null,
        rest: "{}",
      },
    ],
    rowBytes: 100,
    projectedRows: batchIndex + 1,
    totalRows: 2,
    done,
  };
}

function clients() {
  const worker: LibraryCoreProjectionWorkerClient = {
    begin: vi.fn(async () => started()),
    nextBatch: vi
      .fn()
      .mockResolvedValueOnce(batch(0, false))
      .mockResolvedValueOnce(batch(1, true)),
    cancel: vi.fn(async () => {}),
  };
  const native: LibraryCoreShadowNativeClient = {
    begin: vi.fn(async () => status()),
    apply: vi
      .fn()
      .mockResolvedValueOnce(status({ nextBatchIndex: 1, projectedRows: 1 }))
      .mockResolvedValueOnce(
        status({ complete: true, nextBatchIndex: 2, projectedRows: 2 }),
      ),
    finalize: vi.fn(async () =>
      status({
        selected: true,
        complete: true,
        projectedRows: 2,
        generationId: "c".repeat(64),
        transitionSequence: 1,
      }),
    ),
  };
  return { worker, native };
}

describe("Library Core SQLite shadow orchestration", () => {
  it("streams bounded batches, finalizes, and releases the worker session", async () => {
    const { worker, native } = clients();
    const result = await projectLibraryCoreShadow(worker, native, "session");
    expect(result.selected).toBe(true);
    expect(worker.nextBatch).toHaveBeenCalledTimes(2);
    expect(native.apply).toHaveBeenCalledTimes(2);
    expect(native.finalize).toHaveBeenCalledWith("session");
    expect(worker.cancel).toHaveBeenCalledWith("session");
  });

  it("skips worker batches when the exact generation is already selected", async () => {
    const { worker, native } = clients();
    vi.mocked(native.begin).mockResolvedValueOnce(
      status({
        selected: true,
        complete: true,
        generationId: "d".repeat(64),
        transitionSequence: 4,
      }),
    );
    const result = await projectLibraryCoreShadow(worker, native, "session");
    expect(result.generationId).toBe("d".repeat(64));
    expect(worker.nextBatch).not.toHaveBeenCalled();
    expect(native.finalize).not.toHaveBeenCalled();
    expect(worker.cancel).toHaveBeenCalledOnce();
  });

  it("finalizes an empty projection without requesting an empty batch", async () => {
    const { worker, native } = clients();
    vi.mocked(worker.begin).mockResolvedValueOnce(started(0));
    vi.mocked(native.begin).mockResolvedValueOnce(
      status({ complete: true, totalRows: 0 }),
    );
    await projectLibraryCoreShadow(worker, native, "session");
    expect(worker.nextBatch).not.toHaveBeenCalled();
    expect(native.finalize).toHaveBeenCalledOnce();
  });

  it("cancels the worker and preserves the primary failure", async () => {
    const { worker, native } = clients();
    const primary = new Error("native apply failed");
    vi.mocked(native.apply).mockReset().mockRejectedValueOnce(primary);
    vi.mocked(worker.cancel).mockRejectedValueOnce(new Error("cancel failed"));
    await expect(projectLibraryCoreShadow(worker, native, "session")).rejects.toBe(
      primary,
    );
    expect(native.finalize).not.toHaveBeenCalled();
    expect(worker.cancel).toHaveBeenCalledOnce();
  });
});
