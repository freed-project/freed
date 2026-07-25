/**
 * Dedicated, short-lived worker for the cloud CRDT merge.
 *
 * This worker exists to be TERMINATED. `mergeBinaries` loads two full Automerge
 * documents and merges them, which on a real 15,846-item document peaks at
 * 1,356 MB. `WebAssembly.Memory` grows and never shrinks, so whichever thread
 * runs the merge keeps that peak as a permanent floor for the life of the
 * instance. Running it on the renderer's main thread, as it did before, meant
 * the main thread never gave those megabytes back.
 *
 * Terminating this worker after each merge destroys its WASM instance and
 * returns the memory to the OS. That reclaim is the entire point; it is not an
 * incidental cleanup, so do not "optimise" this into a long-lived worker.
 *
 * Note it must be its own worker rather than the main Automerge worker: that
 * one holds the live document and cannot be terminated without dropping it.
 */

import { mergeBinaries } from "@freed/sync/cloud/merge";

export interface CloudMergeRequest {
  reqId: number;
  local: Uint8Array;
  remote: Uint8Array;
  source?: string;
}

export type CloudMergeResponse =
  | { reqId: number; ok: true; merged: Uint8Array }
  | { reqId: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<CloudMergeRequest>) => {
  const { reqId, local, remote, source } = event.data;
  try {
    const merged = mergeBinaries(local, remote, source ? { source } : {});
    const response: CloudMergeResponse = { reqId, ok: true, merged };
    // Transfer rather than copy: the merged document can be tens of MB and a
    // structured clone would briefly double it in the very thread we are
    // trying to keep small.
    (self as unknown as Worker).postMessage(response, [
      merged.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    const response: CloudMergeResponse = {
      reqId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
