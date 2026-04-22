import { invoke, isTauri } from "@tauri-apps/api/core";
import { setRuntimeMemory, type RuntimeMemorySnapshot } from "@freed/ui/lib/debug-store";
import { getStatus as getContentFetcherStatus } from "./content-fetcher";
import { log } from "./logger";

const MEMORY_SAMPLE_INTERVAL_MS = 15_000;
const MEMORY_LOG_INTERVAL = 4;
const HIGH_RESIDENT_BYTES = 1_500 * 1024 * 1024;
const HIGH_RELAY_DOC_BYTES = 64 * 1024 * 1024;

interface NativeRuntimeMemoryStats {
  processResidentBytes: number;
  processVirtualBytes: number;
  relayDocBytes: number;
  relayClientCount: number;
}

interface BrowserMemoryStats {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getRendererMemoryStats(): BrowserMemoryStats | null {
  if (typeof performance === "undefined") return null;
  const perf = performance as Performance & { memory?: BrowserMemoryStats };
  return perf.memory ?? null;
}

function getDomNodeCount(): number | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementsByTagName("*").length;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let sampleCount = 0;
let peakResidentBytes = 0;
let peakRelayDocBytes = 0;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function sampleRuntimeMemory(reason: "startup" | "interval"): Promise<void> {
  const native = isTauri()
    ? await invoke<NativeRuntimeMemoryStats>("get_runtime_memory_stats")
    : {
        processResidentBytes: 0,
        processVirtualBytes: 0,
        relayDocBytes: 0,
        relayClientCount: 0,
      };
  const fetcher = getContentFetcherStatus();
  const renderer = getRendererMemoryStats();
  const domNodeCount = getDomNodeCount();

  peakResidentBytes = Math.max(peakResidentBytes, native.processResidentBytes);
  peakRelayDocBytes = Math.max(peakRelayDocBytes, native.relayDocBytes);

  const snapshot: RuntimeMemorySnapshot = {
    processResidentBytes: native.processResidentBytes,
    processVirtualBytes: native.processVirtualBytes,
    relayDocBytes: native.relayDocBytes,
    relayClientCount: native.relayClientCount,
    contentQueuePending: fetcher.pending,
    contentCompleted: fetcher.completed,
    contentFailed: fetcher.failedCount,
    rendererHeapUsedBytes: renderer?.usedJSHeapSize,
    rendererHeapTotalBytes: renderer?.totalJSHeapSize,
    rendererHeapLimitBytes: renderer?.jsHeapSizeLimit,
    domNodeCount,
    sampleTs: Date.now(),
  };
  setRuntimeMemory(snapshot);

  sampleCount += 1;
  const shouldLog =
    reason === "startup" ||
    sampleCount % MEMORY_LOG_INTERVAL === 0 ||
    (isTauri() && native.processResidentBytes >= HIGH_RESIDENT_BYTES) ||
    native.relayDocBytes >= HIGH_RELAY_DOC_BYTES;

  if (!shouldLog) return;

  const level =
    (isTauri() && native.processResidentBytes >= HIGH_RESIDENT_BYTES) ||
    native.relayDocBytes >= HIGH_RELAY_DOC_BYTES
      ? "warn"
      : "info";

  log[level](
    `[memory] rss=${formatBytes(native.processResidentBytes)} ` +
      `peak_rss=${formatBytes(peakResidentBytes)} ` +
      `virtual=${formatBytes(native.processVirtualBytes)} ` +
      `relay_doc=${formatBytes(native.relayDocBytes)} ` +
      `peak_relay_doc=${formatBytes(peakRelayDocBytes)} ` +
      `relay_clients=${native.relayClientCount.toLocaleString()} ` +
      `fetch_pending=${fetcher.pending.toLocaleString()} ` +
      `fetch_completed=${fetcher.completed.toLocaleString()} ` +
      `fetch_failed=${fetcher.failedCount.toLocaleString()}` +
      (renderer
        ? ` renderer_heap=${formatBytes(renderer.usedJSHeapSize)} ` +
          `renderer_total=${formatBytes(renderer.totalJSHeapSize)}`
        : "") +
      (domNodeCount !== undefined ? ` dom_nodes=${domNodeCount.toLocaleString()}` : ""),
  );
}

export function startMemoryMonitor(): void {
  if (intervalHandle) return;

  void sampleRuntimeMemory("startup").catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`[memory] startup sample failed: ${msg}`);
  });

  intervalHandle = setInterval(() => {
    void sampleRuntimeMemory("interval").catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`[memory] interval sample failed: ${msg}`);
    });
  }, MEMORY_SAMPLE_INTERVAL_MS);
}

export function stopMemoryMonitor(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
}
