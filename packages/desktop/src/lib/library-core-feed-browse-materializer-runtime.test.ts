import { describe, expect, it, vi } from "vitest";

import type {
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreFeedBrowseProjectionBatchV1,
} from "./automerge-types";
import {
  materializeDesktopLibraryCoreFeedBrowseGeneration,
  type LibraryCoreFeedBrowseGenerationStatusV1,
  type LibraryCoreFeedBrowseNativeClient,
  type LibraryCoreFeedBrowseProjectionStartedV1,
  type LibraryCoreFeedBrowseProjectionWorkerClient,
} from "./library-core-feed-browse-materializer-runtime";

const binding: LibraryCoreFeedBrowseGenerationBindingV1 = {
  generationId: "a".repeat(64),
  sourceDocumentId: "library-1",
  sourceHeadsDigest: "b".repeat(64),
  sourceHeadCount: 2,
  transitionSequence: 7,
  projectionRevision: 11,
  filterJson:
    '{"archivedOnly":false,"authorId":null,"feedUrl":null,"platform":null,"savedOnly":false,"schemaVersion":1,"showHidden":false,"signals":[],"socialContentFilter":"all","tags":[]}',
  rankingClockMs: 1_780_000_000_000,
  recommendationOrderSchemaVersion: 1,
  totalRows: 129,
};

const started: LibraryCoreFeedBrowseProjectionStartedV1 = {
  reqId: 1,
  type: "LIBRARY_CORE_FEED_BROWSE_PROJECTION_STARTED",
  sessionId: "session-1",
  binding,
  filter: JSON.parse(binding.filterJson),
  nextBatchIndex: 0,
  projectedRows: 0,
  maximumBatchRows: 128,
};

function batch(
  batchIndex: number,
  rowCount: number,
  projectedRows: number,
  done: boolean,
): LibraryCoreFeedBrowseProjectionBatchV1 {
  return {
    sessionId: started.sessionId,
    binding,
    batchIndex,
    rows: Array.from({ length: rowCount }, (_, index) => {
      const globalId = `x:${batchIndex}:${index}`;
      return {
        priority: 50,
        publishedAt: 1_700_000_000_000,
        sourceSequence: batchIndex * 128 + index,
        globalId,
        cardJson: JSON.stringify({ globalId }),
      };
    }),
    projectedRows,
    done,
  };
}

describe("Desktop Library Core browse materializer runtime", () => {
  it("replays bounded worker pages and recovers append and finalize responses", async () => {
    const pages = [batch(0, 128, 128, false), batch(1, 1, 129, true)];
    const worker: LibraryCoreFeedBrowseProjectionWorkerClient = {
      begin: vi.fn(async () => started),
      nextBatch: vi.fn(async (_sessionId, batchIndex) => pages[batchIndex]),
      cancel: vi.fn(async () => {}),
    };
    let progress: LibraryCoreFeedBrowseGenerationStatusV1 = {
      generationId: binding.generationId,
      nextBatchIndex: 0,
      writtenRows: 0,
      totalRows: binding.totalRows,
      complete: false,
    };
    let appendCalls = 0;
    let finalizeCalls = 0;
    const native: LibraryCoreFeedBrowseNativeClient = {
      begin: vi.fn(async () => progress),
      append: vi.fn(async (input) => {
        appendCalls += 1;
        progress = {
          ...progress,
          nextBatchIndex: input.batchIndex + 1,
          writtenRows: input.projectedRows,
        };
        if (appendCalls === 2) throw new Error("lost append response");
        return progress;
      }),
      finalize: vi.fn(async () => {
        finalizeCalls += 1;
        progress = { ...progress, complete: true };
        throw new Error("lost finalize response");
      }),
      cancel: vi.fn(async () => progress),
    };

    const result = await materializeDesktopLibraryCoreFeedBrowseGeneration(
      worker,
      native,
      started.sessionId,
      undefined,
      binding.rankingClockMs,
    );

    expect(pages.map(({ rows }) => rows.length)).toStrictEqual([128, 1]);
    expect(worker.nextBatch).toHaveBeenCalledTimes(2);
    expect(native.append).toHaveBeenCalledTimes(2);
    expect(native.begin).toHaveBeenCalledTimes(3);
    expect(finalizeCalls).toBe(1);
    expect(result.status).toMatchObject({
      complete: true,
      nextBatchIndex: 2,
      writtenRows: 129,
    });
    expect(worker.cancel).toHaveBeenCalledWith(started.sessionId);
    expect(native.cancel).not.toHaveBeenCalled();
  });

  it("replays exact earlier pages when native progress survived a restart", async () => {
    const pages = [batch(0, 128, 128, false), batch(1, 1, 129, true)];
    const worker: LibraryCoreFeedBrowseProjectionWorkerClient = {
      begin: vi.fn(async () => started),
      nextBatch: vi.fn(async (_sessionId, batchIndex) => pages[batchIndex]),
      cancel: vi.fn(async () => {}),
    };
    let progress: LibraryCoreFeedBrowseGenerationStatusV1 = {
      generationId: binding.generationId,
      nextBatchIndex: 1,
      writtenRows: 128,
      totalRows: binding.totalRows,
      complete: false,
    };
    const native: LibraryCoreFeedBrowseNativeClient = {
      begin: vi.fn(async () => progress),
      append: vi.fn(async (input) => {
        if (input.batchIndex === 0) {
          throw new Error("lost replay response");
        }
        progress = {
          ...progress,
          nextBatchIndex: input.batchIndex + 1,
          writtenRows: input.projectedRows,
        };
        return progress;
      }),
      finalize: vi.fn(async () => {
        progress = { ...progress, complete: true };
        return progress;
      }),
      cancel: vi.fn(async () => progress),
    };

    const result = await materializeDesktopLibraryCoreFeedBrowseGeneration(
      worker,
      native,
      started.sessionId,
      undefined,
      binding.rankingClockMs,
    );

    expect(native.begin).toHaveBeenCalledTimes(2);
    expect(native.append).toHaveBeenCalledTimes(2);
    expect(result.status).toMatchObject({
      complete: true,
      nextBatchIndex: 2,
      writtenRows: 129,
    });
  });
});
