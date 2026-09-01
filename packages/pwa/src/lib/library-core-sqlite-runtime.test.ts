import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "@freed/shared/library-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const QUERY_SOURCE = Object.freeze({
  generationId: "11".repeat(32),
  projectionRevision: 0,
  transitionSequence: 0,
});

function validStatus() {
  return {
    connectionGeneration: 1,
    contractVersion: LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
    engine: "sqlite-wasm-opfs-sahpool" as const,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    schemaSha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
    schemaVersion: LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
    sqliteVersion: "3.50.4",
    storage: "opfs" as const,
  };
}

function facetSummary() {
  return {
    archivedCount: 0,
    archivableCount: 0,
    contactAccountCount: 0,
    contactLinkedPersonCount: 0,
    enabledRssFeedCount: 0,
    friendPersonCount: 0,
    latestContactImportedAt: null,
    latestRssFeedFetchedAt: null,
    platformCounts: [],
    rssFeedCount: 0,
    sampleAccountCount: 0,
    sampleFeedCount: 0,
    sampleItemCount: 0,
    samplePersonCount: 0,
    savedArchivedCount: 0,
    savedCount: 0,
    savedPlatformCount: 0,
    socialAccountCount: 0,
    tags: [],
    totalCount: 0,
    unreadCount: 0,
  };
}

class RecoveringWorker {
  static instances: RecoveringWorker[] = [];
  static failNextOperation = true;

  readonly listeners = new Map<
    string,
    (event: MessageEvent<unknown>) => void
  >();
  readonly posted: Array<Record<string, unknown>> = [];
  terminateCount = 0;

  constructor() {
    RecoveringWorker.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.set(type, listener);
  }

  postMessage(value: unknown): void {
    const request = value as Record<string, unknown>;
    this.posted.push(request);
    queueMicrotask(() => {
      if (request.kind === "open") {
        this.respond({
          ok: true,
          requestId: request.requestId,
          status: validStatus(),
        });
        return;
      }
      if (RecoveringWorker.failNextOperation) {
        RecoveringWorker.failNextOperation = false;
        this.listeners.get("error")?.({} as MessageEvent<unknown>);
        return;
      }
      if (request.kind === "query") {
        this.respond({
          ok: true,
          requestId: request.requestId,
          result: {
            queryId: "library_facet_summary_v1",
            schemaVersion: 1,
            source: QUERY_SOURCE,
            summary: facetSummary(),
          },
        });
      }
    });
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  respond(value: unknown): void {
    this.listeners.get("message")?.({ data: value } as MessageEvent<unknown>);
  }
}

describe("PWA SQLite runtime worker recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    RecoveringWorker.instances = [];
    RecoveringWorker.failNextOperation = true;
    vi.stubGlobal("Worker", RecoveringWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reopens the accepted OPFS Library and retries one read after worker loss", async () => {
    const { queryPwaNormalizedLibrary } = await import(
      "./library-core-sqlite-runtime"
    );

    await expect(
      queryPwaNormalizedLibrary({
        queryId: "library_facet_summary_v1",
        schemaVersion: 1,
      }),
    ).resolves.toEqual({
      queryId: "library_facet_summary_v1",
      schemaVersion: 1,
      source: QUERY_SOURCE,
      summary: facetSummary(),
    });

    expect(RecoveringWorker.instances).toHaveLength(2);
    expect(RecoveringWorker.instances[0]?.terminateCount).toBe(1);
    expect(
      RecoveringWorker.instances.flatMap((worker) => worker.posted),
    ).toEqual([
      expect.objectContaining({ kind: "open" }),
      expect.objectContaining({ kind: "query" }),
      expect.objectContaining({ kind: "open" }),
      expect.objectContaining({ kind: "query" }),
    ]);
  });

  it("does not replay a mutation with an ambiguous response", async () => {
    const { mutatePwaDeviceGraphLayout } = await import(
      "./library-core-sqlite-runtime"
    );

    await expect(
      mutatePwaDeviceGraphLayout({
        entityId: "account:1",
        mutationId: "account_graph_position_clear_v1",
        schemaVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: "pwa_sqlite_worker_unavailable",
    });

    expect(RecoveringWorker.instances).toHaveLength(1);
    expect(
      RecoveringWorker.instances[0]?.posted.filter(
        (request) => request.kind === "mutate_device_graph_layout",
      ),
    ).toHaveLength(1);
  });
});
