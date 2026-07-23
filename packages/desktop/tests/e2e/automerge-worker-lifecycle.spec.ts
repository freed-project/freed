import { test, expect } from "./fixtures/app";
import type { Page } from "@playwright/test";
import { createLargeAutomergeFixture } from "../../src/lib/__fixtures__/large-automerge-doc";

interface WorkerMessageSummary {
  sequence: number;
  type: string;
  bytes: number | null;
  detail: string | null;
}

interface WorkerProbeRecord {
  generation: number;
  createdSequence: number;
  url: string;
  createdAt: number;
  terminatedSequence: number | null;
  terminatedAt: number | null;
  outbound: WorkerMessageSummary[];
  inbound: WorkerMessageSummary[];
}

function messageCount(
  records: WorkerProbeRecord[],
  direction: "inbound" | "outbound",
  type: string,
): number {
  return records.reduce(
    (total, record) =>
      total +
      record[direction].filter((message) => message.type === type).length,
    0,
  );
}

async function readWorkerProbeRecords(page: Page): Promise<WorkerProbeRecord[]> {
  return page.evaluate(() => {
    return (
      (
        window as Window & {
          __FREED_WORKER_PROBE__?: { records: WorkerProbeRecord[] };
        }
      ).__FREED_WORKER_PROBE__?.records ?? []
    );
  });
}

test("large document survives real worker idle termination and reinitialization", async ({
  app,
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  const fixture = createLargeAutomergeFixture();
  expect(fixture.manifest.binaryBytes).toBeGreaterThanOrEqual(
    fixture.manifest.targetBytes,
  );
  expect(fixture.manifest.binaryBytes).toBeLessThan(8 * 1024 * 1024);

  await page.route("**/__automerge-memory-fixture.bin", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: Buffer.from(fixture.binary),
    });
  });

  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const records: WorkerProbeRecord[] = [];
    let nextSequence = 1;

    function summarizeMessage(data: unknown): WorkerMessageSummary {
      const sequence = nextSequence;
      nextSequence += 1;
      if (!data || typeof data !== "object") {
        return { sequence, type: typeof data, bytes: null, detail: null };
      }
      const message = data as {
        type?: unknown;
        binary?: unknown;
        data?: unknown;
        detail?: unknown;
        docBytes?: unknown;
      };
      const binaryBytes =
        message.binary instanceof Uint8Array
          ? message.binary.byteLength
          : message.binary instanceof ArrayBuffer
            ? message.binary.byteLength
            : null;
      const relayBytes = Array.isArray(message.data)
        ? message.data.length
        : null;
      const initBytes =
        typeof message.docBytes === "number" ? message.docBytes : null;
      return {
        sequence,
        type:
          typeof message.type === "string" ? message.type : typeof message.type,
        bytes: binaryBytes ?? relayBytes ?? initBytes,
        detail: typeof message.detail === "string" ? message.detail : null,
      };
    }

    class ProbedWorker extends OriginalWorker {
      private readonly probeIndex: number;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.probeIndex = records.length;
        const createdSequence = nextSequence;
        nextSequence += 1;
        records.push({
          generation: this.probeIndex,
          createdSequence,
          url: String(scriptURL),
          createdAt: performance.now(),
          terminatedSequence: null,
          terminatedAt: null,
          outbound: [],
          inbound: [],
        });
        this.addEventListener("message", (event) => {
          records[this.probeIndex]?.inbound.push(summarizeMessage(event.data));
        });
      }

      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        records[this.probeIndex]?.outbound.push(summarizeMessage(message));
        if (transferOrOptions === undefined) {
          OriginalWorker.prototype.postMessage.call(this, message);
        } else {
          OriginalWorker.prototype.postMessage.call(
            this,
            message,
            transferOrOptions,
          );
        }
      }

      override terminate(): void {
        const record = records[this.probeIndex];
        if (record && record.terminatedAt === null) {
          record.terminatedSequence = nextSequence;
          nextSequence += 1;
          record.terminatedAt = performance.now();
        }
        super.terminate();
      }
    }

    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: ProbedWorker,
    });
    (
      window as Window & {
        __FREED_WORKER_PROBE__?: { records: WorkerProbeRecord[] };
      }
    ).__FREED_WORKER_PROBE__ = { records };
  });

  await app.goto();
  await app.waitForReady(30_000);

  const replacement = await page.evaluate(async (mutationTargetId) => {
    const response = await fetch("/__automerge-memory-fixture.bin");
    if (!response.ok) {
      throw new Error(
        `Fixture request failed with ${response.status.toLocaleString()}`,
      );
    }
    const binary = new Uint8Array(await response.arrayBuffer());
    const automerge = (
      window as Window & {
        __FREED_AUTOMERGE__?: {
          replaceLocalDoc: (value: Uint8Array) => Promise<void>;
          getDocState: () => {
            docItemCount: number;
            items: Array<{
              globalId: string;
              userState: { readAt?: number };
            }>;
          } | null;
        };
      }
    ).__FREED_AUTOMERGE__;
    if (!automerge) throw new Error("Automerge test API is unavailable");
    await automerge.replaceLocalDoc(binary);
    const state = automerge.getDocState();
    return {
      binaryBytes: binary.byteLength,
      docItemCount: state?.docItemCount ?? 0,
      readAt:
        state?.items.find((item) => item.globalId === mutationTargetId)
          ?.userState.readAt ?? null,
    };
  }, fixture.manifest.mutationTargetId);

  expect(replacement.binaryBytes).toBe(fixture.manifest.binaryBytes);
  expect(replacement.docItemCount).toBe(fixture.manifest.itemCount);
  expect(replacement.readAt).toBeNull();

  const recordsAfterReplacement = await readWorkerProbeRecords(page);
  const replacementWorker = recordsAfterReplacement.find((record) =>
    record.outbound.some(
      (message) =>
        message.type === "REPLACE_DOC" &&
        message.bytes === fixture.manifest.binaryBytes,
    ),
  );
  if (!replacementWorker) {
    throw new Error("No worker received the large fixture replacement");
  }
  const replaceMessage = replacementWorker.outbound.find(
    (message) =>
      message.type === "REPLACE_DOC" &&
      message.bytes === fixture.manifest.binaryBytes,
  );
  if (!replaceMessage) {
    throw new Error("Large fixture replacement message was not recorded");
  }
  const replacementGeneration = replacementWorker.generation;
  const replacementSequence = replaceMessage.sequence;

  await expect
    .poll(
      async () => {
        const record = (await readWorkerProbeRecords(page)).find(
          (candidate) => candidate.generation === replacementGeneration,
        );
        return (
          record?.inbound.some(
            (message) =>
              message.sequence > replacementSequence &&
              message.type === "DEBUG_EVENT" &&
              message.detail?.startsWith(
                "[automerge-worker] released idle document",
              ),
          ) ?? false
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  await expect
    .poll(
      async () => {
        const record = (await readWorkerProbeRecords(page)).find(
          (candidate) => candidate.generation === replacementGeneration,
        );
        return record?.terminatedSequence ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(replacementSequence);

  const mutation = await page.evaluate(async (mutationTargetId) => {
    const automerge = (
      window as Window & {
        __FREED_AUTOMERGE__?: {
          docMarkAsRead: (globalId: string) => Promise<void>;
          getDocBinary: () => Promise<Uint8Array>;
          getDocState: () => {
            docItemCount: number;
            items: Array<{
              globalId: string;
              userState: { readAt?: number };
            }>;
          } | null;
        };
      }
    ).__FREED_AUTOMERGE__;
    if (!automerge) throw new Error("Automerge test API is unavailable");
    await automerge.docMarkAsRead(mutationTargetId);
    const binary = await automerge.getDocBinary();
    const state = automerge.getDocState();
    return {
      binaryBytes: binary.byteLength,
      docItemCount: state?.docItemCount ?? 0,
      readAt:
        state?.items.find((item) => item.globalId === mutationTargetId)
          ?.userState.readAt ?? null,
    };
  }, fixture.manifest.mutationTargetId);

  expect(mutation.docItemCount).toBe(fixture.manifest.itemCount);
  expect(mutation.binaryBytes).toBeGreaterThan(0);
  expect(typeof mutation.readAt).toBe("number");

  const records = await readWorkerProbeRecords(page);
  const automergeWorkers = records.filter((record) =>
    record.url.includes("automerge.worker"),
  );
  const completedReplacementWorker = automergeWorkers.find(
    (record) => record.generation === replacementGeneration,
  );
  if (!completedReplacementWorker) {
    throw new Error("Large fixture worker record disappeared");
  }
  if (completedReplacementWorker.terminatedSequence === null) {
    throw new Error("Large fixture worker did not record its termination");
  }
  const replacementTerminationSequence =
    completedReplacementWorker.terminatedSequence;
  const reinitializedWorker = automergeWorkers.find((record) => {
    if (
      record.generation <= replacementGeneration ||
      record.createdSequence <= replacementTerminationSequence
    ) {
      return false;
    }
    const initMessage = record.outbound.find(
      (message) => message.type === "INIT",
    );
    const initStatsMessage = record.inbound.find(
      (message) =>
        message.type === "INIT_STATS" &&
        message.bytes !== null &&
        message.bytes >= fixture.manifest.targetBytes,
    );
    const mutationMessage = record.outbound.find(
      (message) => message.type === "MARK_AS_READ",
    );
    return (
      initMessage !== undefined &&
      initStatsMessage !== undefined &&
      mutationMessage !== undefined &&
      replacementTerminationSequence < initMessage.sequence &&
      initMessage.sequence < initStatsMessage.sequence &&
      initStatsMessage.sequence < mutationMessage.sequence
    );
  });
  if (!reinitializedWorker) {
    throw new Error(
      "No later worker initialized the persisted large document before mutation",
    );
  }
  const evidence = {
    fixture: fixture.manifest,
    replacementLifecycle: {
      generation: replacementGeneration,
      requestSequence: replacementSequence,
      terminationSequence: replacementTerminationSequence,
    },
    reinitializedGeneration: reinitializedWorker.generation,
    result: mutation,
    workerCount: automergeWorkers.length,
    terminationCount: automergeWorkers.filter(
      (record) => record.terminatedAt !== null,
    ).length,
    readyCount: messageCount(automergeWorkers, "inbound", "READY"),
    initStatsCount: messageCount(automergeWorkers, "inbound", "INIT_STATS"),
    initRequestCount: messageCount(automergeWorkers, "outbound", "INIT"),
    initStatsBytes: automergeWorkers.flatMap((record) =>
      record.inbound.flatMap((message) =>
        message.type === "INIT_STATS" && message.bytes !== null
          ? [message.bytes]
          : [],
      ),
    ),
    lifecycleDetails: automergeWorkers.flatMap((record) =>
      record.inbound.flatMap((message) =>
        message.type === "DEBUG_EVENT" && message.detail
          ? [message.detail]
          : [],
      ),
    ),
    workers: automergeWorkers,
  };

  await testInfo.attach("automerge-worker-lifecycle.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });

  expect(evidence.reinitializedGeneration).toBeGreaterThan(
    evidence.replacementLifecycle.generation,
  );
  expect(
    evidence.initStatsBytes.some(
      (bytes) => bytes >= fixture.manifest.targetBytes,
    ),
  ).toBe(true);
});
