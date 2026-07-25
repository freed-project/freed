/**
 * Desktop cloud-merge strategy: run the merge in a worker, then terminate it.
 *
 * Measured on the owner's real 15,846-item document: `A.load` x2 + `A.merge`
 * peaks at 1,356 MB. Because `WebAssembly.Memory` has `grow()` and no
 * `shrink()`, that peak became a permanent floor on the renderer's main thread,
 * where `gdriveUploadSafe` / `dropboxUploadSafe` previously ran it.
 *
 * Terminating the worker after each merge is what actually reclaims the memory.
 * A pooled or long-lived worker would reintroduce exactly the ratchet this
 * removes, so the terminate is load-bearing.
 */

import type { CloudMergeStrategy } from "@freed/sync/cloud/merge";

import type {
  CloudMergeRequest,
  CloudMergeResponse,
} from "./cloud-merge.worker";
import { recordRuntimeHealthEvent } from "./runtime-health-events";

// A merge that has not returned by now is not going to. Failing here leaves the
// upload to retry on the next cycle, which is strictly better than a worker
// wedged open holding a gigabyte.
const CLOUD_MERGE_TIMEOUT_MS = 120_000;

let nextReqId = 1;

export class CloudMergeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudMergeFailedError";
  }
}

function spawnMergeWorker(): Worker {
  return new Worker(new URL("./cloud-merge.worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * Merge two Automerge binaries in a throwaway worker.
 *
 * Always terminates the worker, including on error and on timeout. The whole
 * benefit is the terminate.
 */
export const workerCloudMerge: CloudMergeStrategy = async (
  local,
  remote,
  options,
) => {
  const reqId = nextReqId++;
  const worker = spawnMergeWorker();
  const startedAt = Date.now();

  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new CloudMergeFailedError(
            `Cloud merge did not finish within ${(CLOUD_MERGE_TIMEOUT_MS / 1000).toLocaleString()}s`,
          ),
        );
      }, CLOUD_MERGE_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<CloudMergeResponse>) => {
        clearTimeout(timer);
        const data = event.data;
        if (data.reqId !== reqId) return;
        if (data.ok) resolve(data.merged);
        else reject(new CloudMergeFailedError(data.error));
      };

      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(
          new CloudMergeFailedError(event.message || "cloud merge worker error"),
        );
      };

      const request: CloudMergeRequest = {
        reqId,
        local,
        remote,
        ...(options?.source ? { source: options.source } : {}),
      };
      worker.postMessage(request);
    });
  } finally {
    // Load-bearing: this is what returns the ~1.3 GB peak to the OS.
    worker.terminate();
    try {
      recordRuntimeHealthEvent({
        event: "cloud_merge_worker_completed",
        durationMs: Date.now() - startedAt,
      });
    } catch {
      // Telemetry must never break a sync.
    }
  }
};
